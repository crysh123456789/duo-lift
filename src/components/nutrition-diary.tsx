"use client";

import { useEffect, useId, useState } from "react";
import { SessionDateField } from "@/components/session-date-field";
import { Button, Field, NumberField, Panel } from "@/components/ui";
import { PageTitle } from "@/components/page-title";
import { whenLabel } from "@/lib/format";
import { nid } from "@/lib/ids";
import {
  DIARY_SAVED,
  EMPTY_ITEMS_COPY,
  MEAL_SLOTS,
  NO_TIME_LABEL,
  OPTIONAL_NOTE_LABEL,
  PROTEIN_TODAY_LABEL,
  QUICK_ITEM_LABEL,
  SAVED_NOTE_LABEL,
  blankMealItem,
  dayTotals,
  foodDayFor,
  formatTotals,
  mealLogged,
  mealSummary,
  mealTimeLabel,
  mealTotals,
  nextMealPrompt,
  manualProteinGoal,
  normalizeMealLog,
  shiftStamp,
  todayStamp,
} from "@/lib/nutrition";
import { isValidStamp } from "@/lib/session-date";
import { useGymStore } from "@/lib/store";
import type { MealEntry, MealItem, MealLog, MealSlot } from "@/lib/types";

export function NutritionDiary() {
  const activeUserId = useGymStore((s) => s.activeUserId);
  const [date, setDate] = useState(todayStamp());
  const [editing, setEditing] = useState<MealSlot | null>(null);
  const [seedItem, setSeedItem] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [toast, setToast] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(false), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  function selectDate(stamp: string) {
    if (!isValidStamp(stamp)) return;
    setDate(stamp);
    setEditing(null);
    setSeedItem(false);
  }

  function openMeal(slot: MealSlot) {
    setSeedItem(false);
    setEditorKey((n) => n + 1);
    setEditing(slot);
  }

  function quickAdd(slot: MealSlot) {
    setSeedItem(true);
    setEditorKey((n) => n + 1);
    setEditing(slot);
  }

  const today = todayStamp();

  return (
    <div className="space-y-4 pb-28">
      <PageTitle title={`Diario · ${whenLabel(`${date}T12:00:00`)}`} />
      {editing ? (
        <MealEditor
          key={`${activeUserId}:${date}:${editing}:${editorKey}`}
          date={date}
          slot={editing}
          seedItem={seedItem}
          onClose={() => {
            setEditing(null);
            setSeedItem(false);
          }}
          onSaved={() => {
            setEditing(null);
            setSeedItem(false);
            setToast(true);
          }}
        />
      ) : (
        <DayScreen
          date={date}
          onDate={selectDate}
          onYesterday={() => selectDate(shiftStamp(date, -1))}
          onToday={date === today ? undefined : () => selectDate(today)}
          onOpen={openMeal}
          onQuick={quickAdd}
        />
      )}
      {toast ? (
        <p
          role="status"
          className="fixed left-1/2 top-28 z-40 -translate-x-1/2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink sm:top-20"
        >
          {DIARY_SAVED}
        </p>
      ) : null}
    </div>
  );
}

function DayScreen({
  date,
  onDate,
  onYesterday,
  onToday,
  onOpen,
  onQuick,
}: {
  date: string;
  onDate: (stamp: string) => void;
  onYesterday: () => void;
  onToday?: () => void;
  onOpen: (slot: MealSlot) => void;
  onQuick: (slot: MealSlot) => void;
}) {
  const data = useGymStore();
  const me = data.users.find((user) => user.id === data.activeUserId);
  const saved = foodDayFor(data, data.activeUserId, date);
  const meals = saved?.meals ?? normalizeMealLog(undefined);
  const totals = dayTotals(meals);
  const goal = manualProteinGoal(me);
  const prompt = nextMealPrompt(meals);
  const quickSlot = prompt?.id ?? "cena";
  const quickLabel = MEAL_SLOTS.find((slot) => slot.id === quickSlot)?.label ?? "Cena";
  const proteinLabel = date === todayStamp() ? PROTEIN_TODAY_LABEL : "Proteína";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-medium">{whenLabel(`${date}T12:00:00`)}</h2>
        <div className="flex gap-1">
          <Button className="h-12 min-h-12 px-3" onClick={onYesterday}>
            Ayer
          </Button>
          {onToday ? (
            <Button className="h-12 min-h-12 px-3" onClick={onToday}>
              Hoy
            </Button>
          ) : null}
        </div>
      </div>
      <SessionDateField
        value={date}
        onChange={onDate}
        label="Fecha"
        hint="Así el diario queda en el día correcto."
      />
      <div className="sticky top-[5.75rem] z-20 -mx-4 border-y border-line bg-background/95 px-4 py-3 backdrop-blur-md sm:top-14">
        <p className="text-[11px] uppercase tracking-wider text-muted">{proteinLabel}</p>
        <p className="mt-1 font-mono text-sm tabular-nums" aria-label={`${proteinLabel} ${formatTotals(totals, goal)}`}>
          {formatTotals(totals, goal)}
        </p>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {MEAL_SLOTS.map((slot) => {
          const entry = meals[slot.id];
          return (
            <li key={slot.id}>
              <button
                type="button"
                onClick={() => onOpen(slot.id)}
                className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{slot.label}</span>
                  <span className="block text-xs text-muted">{mealTimeLabel(entry.time)}</span>
                  {entry.note.trim() && entry.items.length === 0 ? (
                    <span className="mt-1 block truncate text-sm text-muted">
                      {SAVED_NOTE_LABEL}: {entry.note}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right font-mono text-xs tabular-nums text-muted">
                  {mealSummary(entry)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {saved?.comment ? (
        <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">{saved.comment}</p>
      ) : null}
      <HistoryList selected={date} onOpen={onDate} />
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-background/95 p-3 backdrop-blur-md md:bottom-0 md:left-52">
        <div className="mx-auto max-w-lg">
          <Button variant="primary" className="h-12 min-h-12 w-full" onClick={() => onQuick(quickSlot)}>
            {QUICK_ITEM_LABEL}
          </Button>
          <p className="mt-1 text-center text-xs text-muted">
            {prompt ? prompt.question : `En ${quickLabel.toLowerCase()}`}
          </p>
        </div>
      </div>
    </div>
  );
}

function HistoryList({ selected, onOpen }: { selected: string; onOpen: (stamp: string) => void }) {
  const data = useGymStore();
  const me = data.users.find((user) => user.id === data.activeUserId);
  const goal = manualProteinGoal(me);
  const mine = [...(data.foodDays ?? [])]
    .filter((day) => day.userId === data.activeUserId && day.date !== selected)
    .map((day) => ({ ...day, meals: normalizeMealLog(day.meals) }))
    .filter((day) => MEAL_SLOTS.some((slot) => mealLogged(day.meals[slot.id])))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);
  if (mine.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted">Historial</h2>
      <ul className="space-y-2">
        {mine.map((day) => (
          <li key={day.id}>
            <button
              type="button"
              onClick={() => onOpen(day.date)}
              className="w-full rounded-2xl border border-line px-4 py-3 text-left hover:bg-surface"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{whenLabel(`${day.date}T12:00:00`)}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted">
                  {formatTotals(dayTotals(day.meals), goal)}
                </span>
              </span>
              <span className="mt-2 block space-y-1">
                {MEAL_SLOTS.filter((slot) => mealLogged(day.meals[slot.id])).map((slot) => {
                  const entry = day.meals[slot.id];
                  const names = entry.items.map((item) => item.name).filter(Boolean).join(", ");
                  return (
                    <span key={slot.id} className="block text-sm">
                      <span className="text-muted">
                        {slot.label} · {mealTimeLabel(entry.time)} · {mealSummary(entry)}
                      </span>
                      {names ? <span className="mt-0.5 block">{names}</span> : null}
                      {entry.note.trim() ? (
                        <span className="mt-0.5 block text-muted">
                          {SAVED_NOTE_LABEL}: {entry.note}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MealEditor({
  date,
  slot,
  seedItem,
  onClose,
  onSaved,
}: {
  date: string;
  slot: MealSlot;
  seedItem: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const data = useGymStore();
  const saveFoodDay = useGymStore((s) => s.saveFoodDay);
  const me = data.users.find((user) => user.id === data.activeUserId);
  const saved = foodDayFor(data, data.activeUserId, date);
  const meals = saved?.meals ?? normalizeMealLog(undefined);
  const label = MEAL_SLOTS.find((item) => item.id === slot)?.label ?? "Comida";
  const [entry, setEntry] = useState<MealEntry>(() => {
    const current = meals[slot];
    if (!seedItem) return current;
    return { ...current, items: [...current.items, blankMealItem(nid())] };
  });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [legacyNote] = useState(() => meals[slot].note.trim().length > 0);
  const [noteOpen, setNoteOpen] = useState(false);
  const goal = manualProteinGoal(me);
  const proteinLabel = date === todayStamp() ? PROTEIN_TODAY_LABEL : "Proteína";
  const draftMeals: MealLog = { ...meals, [slot]: entry };
  const showNote = legacyNote || noteOpen || entry.note.trim().length > 0;

  function patchItem(id: string, patch: Partial<MealItem>) {
    setEntry((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  }

  function addItem() {
    setEntry((prev) => ({ ...prev, items: [...prev.items, blankMealItem(nid())] }));
  }

  function removeItem(id: string) {
    setEntry((prev) => ({ ...prev, items: prev.items.filter((item) => item.id !== id) }));
    setConfirmId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted">{whenLabel(`${date}T12:00:00`)}</p>
          <h2 className="text-lg font-medium">{label}</h2>
        </div>
        <Button className="h-12 min-h-12 px-3" onClick={onClose}>
          Volver
        </Button>
      </div>
      <TimeInput time={entry.time} onChange={(time) => setEntry((prev) => ({ ...prev, time }))} />
      {entry.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-4 text-sm text-muted">{EMPTY_ITEMS_COPY}</p>
      ) : (
        <ul className="space-y-3">
          {entry.items.map((item, index) => (
            <li key={item.id}>
              <ItemRow
                item={item}
                autoFocus={seedItem && index === entry.items.length - 1}
                confirming={confirmId === item.id}
                onChange={(patch) => patchItem(item.id, patch)}
                onAskDelete={() => setConfirmId(item.id)}
                onCancelDelete={() => setConfirmId(null)}
                onDelete={() => removeItem(item.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <Button className="h-12 min-h-12 w-full" onClick={addItem}>
        + Añadir ítem
      </Button>
      {showNote ? (
        <Field label={legacyNote ? SAVED_NOTE_LABEL : OPTIONAL_NOTE_LABEL}>
          <textarea
            value={entry.note}
            onChange={(event) => setEntry((prev) => ({ ...prev, note: event.target.value }))}
            rows={3}
            className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 outline-none focus:border-accent"
          />
        </Field>
      ) : (
        <Button className="h-12 min-h-12 w-full" onClick={() => setNoteOpen(true)}>
          {OPTIONAL_NOTE_LABEL}
        </Button>
      )}
      <div className="space-y-1 rounded-xl border border-line bg-surface-2 px-3 py-3">
        <p className="font-mono text-sm tabular-nums">{formatTotals(mealTotals(entry))}</p>
        <p className="text-[11px] uppercase tracking-wider text-muted">{proteinLabel}</p>
        <p className="font-mono text-sm tabular-nums">{formatTotals(dayTotals(draftMeals), goal)}</p>
      </div>
      <Button
        variant="primary"
        className="h-12 min-h-12 w-full"
        onClick={() => {
          const id = saveFoodDay({ date, meals: draftMeals });
          if (id) onSaved();
        }}
      >
        Guardar
      </Button>
    </div>
  );
}

function TimeInput({ time, onChange }: { time: string | null; onChange: (time: string | null) => void }) {
  const hintId = useId();
  return (
    <div className="space-y-2">
      <Field label="Hora">
        <input
          type="time"
          value={time ?? ""}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value || null)}
          className="h-12 min-h-12 w-full rounded-xl border border-line bg-surface-2 px-3 text-base outline-none focus:border-accent"
        />
      </Field>
      <p id={hintId} className="text-xs text-muted">
        {time ? mealTimeLabel(time) : NO_TIME_LABEL}
      </p>
      {time ? (
        <Button className="h-12 min-h-12" onClick={() => onChange(null)}>
          Quitar hora
        </Button>
      ) : null}
    </div>
  );
}

function ItemRow({
  item,
  autoFocus,
  confirming,
  onChange,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  item: MealItem;
  autoFocus: boolean;
  confirming: boolean;
  onChange: (patch: Partial<MealItem>) => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  function clamp(value: number | null) {
    if (value == null) return null;
    return value < 0 ? 0 : value;
  }

  return (
    <Panel className="space-y-3 p-3">
      <Field label="Nombre">
        <input
          value={item.name}
          autoFocus={autoFocus}
          onChange={(event) => onChange({ name: event.target.value })}
          className="h-12 min-h-12 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
        />
      </Field>
      <div className="grid grid-cols-4 gap-2">
        <NumberField label="g" value={item.grams} onChange={(grams) => onChange({ grams: clamp(grams) })} />
        <NumberField label="P" value={item.proteinG} onChange={(proteinG) => onChange({ proteinG: clamp(proteinG) })} />
        <NumberField label="C" value={item.carbsG} onChange={(carbsG) => onChange({ carbsG: clamp(carbsG) })} />
        <NumberField label="G" value={item.fatG} onChange={(fatG) => onChange({ fatG: clamp(fatG) })} />
      </div>
      {confirming ? (
        <div className="flex gap-2">
          <Button variant="danger" className="h-12 min-h-12 flex-1" onClick={onDelete}>
            Confirmar
          </Button>
          <Button className="h-12 min-h-12 flex-1" onClick={onCancelDelete}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button variant="danger" className="h-12 min-h-12 w-full" onClick={onAskDelete}>
          Borrar
        </Button>
      )}
    </Panel>
  );
}
