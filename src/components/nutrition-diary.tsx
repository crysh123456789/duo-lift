"use client";

import { useState } from "react";
import { Button, Field, Panel } from "@/components/ui";
import { dayLabel } from "@/lib/format";
import {
  MEAL_SLOTS,
  emptyMeals,
  foodDayFor,
  nextMealPrompt,
  proteinTargetG,
  todayStamp,
} from "@/lib/nutrition";
import { useGymStore } from "@/lib/store";
import type { MealLog } from "@/lib/types";

export function NutritionDiary() {
  const data = useGymStore();
  const [date, setDate] = useState(todayStamp());
  const saved = foodDayFor(data, data.activeUserId, date);

  function shiftDate(delta: number) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(todayStamp(d));
  }

  return (
    <DayEditor
      key={`${data.activeUserId}:${date}:${saved?.id ?? "new"}:${saved?.updatedAt ?? ""}`}
      date={date}
      onYesterday={() => shiftDate(-1)}
      onToday={date !== todayStamp() ? () => setDate(todayStamp()) : undefined}
    />
  );
}

function DayEditor({
  date,
  onYesterday,
  onToday,
}: {
  date: string;
  onYesterday: () => void;
  onToday?: () => void;
}) {
  const data = useGymStore();
  const saveFoodDay = useGymStore((s) => s.saveFoodDay);
  const me = data.users.find((u) => u.id === data.activeUserId);
  const saved = foodDayFor(data, data.activeUserId, date);
  const [dump, setDump] = useState("");
  const [meals, setMeals] = useState<MealLog>(saved?.meals ?? emptyMeals());

  if (!me) return null;
  const prompt = nextMealPrompt(meals);

  function setSlot(id: keyof MealLog, value: string) {
    setMeals((prev) => ({ ...prev, [id]: value }));
  }

  return (
    <div className="space-y-4">
      <Panel className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">{dayLabel(`${date}T12:00:00`)}</h2>
          <div className="flex gap-1">
            <Button className="h-10 px-3" onClick={onYesterday}>
              Ayer
            </Button>
            {onToday ? (
              <Button className="h-10 px-3" onClick={onToday}>
                Hoy
              </Button>
            ) : null}
          </div>
        </div>
        {me.weightKg ? (
          <p className="text-sm text-muted">
            Objetivo: ~{proteinTargetG(me.weightKg)} g de proteína y un extra calórico si el día se ve corto.
          </p>
        ) : null}
        <Field label={prompt?.question ?? "¿Algo más que comiste?"}>
          <textarea
            value={dump}
            onChange={(e) => setDump(e.target.value)}
            rows={3}
            placeholder="Pega un párrafo. Lo ordeno en las tomas."
            className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 outline-none focus:border-accent"
          />
        </Field>
        {MEAL_SLOTS.filter((slot) => meals[slot.id].trim() || slot.id === prompt?.id).map((slot) => (
          <Field key={slot.id} label={slot.label}>
            <textarea
              value={meals[slot.id]}
              onChange={(e) => setSlot(slot.id, e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 outline-none focus:border-accent"
            />
          </Field>
        ))}
        <Button
          variant="primary"
          className="w-full"
          onClick={() => {
            saveFoodDay({ date, meals, rawInput: dump });
            const next = useGymStore
              .getState()
              .foodDays.find((d) => d.userId === data.activeUserId && d.date === date);
            if (next) setMeals(next.meals);
            setDump("");
          }}
        >
          Guardar
        </Button>
        {saved?.comment ? (
          <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">{saved.comment}</p>
        ) : null}
      </Panel>
      <PastDays />
    </div>
  );
}

function PastDays() {
  const data = useGymStore();
  const mine = [...(data.foodDays ?? [])]
    .filter((d) => d.userId === data.activeUserId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14);
  if (mine.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted">Días anteriores</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {mine.map((day) => {
          const filled = MEAL_SLOTS.filter((s) => day.meals[s.id].trim());
          return (
            <li key={day.id} className="space-y-1 px-4 py-3">
              <p className="text-sm font-medium">{dayLabel(`${day.date}T12:00:00`)}</p>
              {filled.map((slot) => (
                <p key={slot.id} className="text-sm">
                  <span className="text-muted">{slot.label}:</span> {day.meals[slot.id]}
                </p>
              ))}
              {day.comment ? <p className="text-xs text-muted">{day.comment}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
