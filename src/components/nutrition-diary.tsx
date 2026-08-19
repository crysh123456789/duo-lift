"use client";

import { useEffect, useState } from "react";
import { Button, Field, Panel } from "@/components/ui";
import { dayLabel } from "@/lib/format";
import {
  MEAL_SLOTS,
  bmi,
  emptyMeals,
  foodDayFor,
  nutritionInsights,
  proteinTargetG,
  todayStamp,
} from "@/lib/nutrition";
import { useGymStore } from "@/lib/store";
import type { MealLog } from "@/lib/types";

export function NutritionDiary() {
  const data = useGymStore();
  const saveFoodDay = useGymStore((s) => s.saveFoodDay);
  const updateUser = useGymStore((s) => s.updateUser);
  const me = data.users.find((u) => u.id === data.activeUserId);
  const [date, setDate] = useState(todayStamp());
  const [dump, setDump] = useState("");
  const saved = foodDayFor(data, data.activeUserId, date);
  const [meals, setMeals] = useState<MealLog>(saved?.meals ?? emptyMeals());

  useEffect(() => {
    setMeals(saved?.meals ?? emptyMeals());
    setDump("");
  }, [date, saved?.id]);

  if (!me) return null;

  const index = me.heightCm && me.weightKg ? bmi(me.heightCm, me.weightKg) : null;

  function setSlot(id: keyof MealLog, value: string) {
    setMeals((prev) => ({ ...prev, [id]: value }));
  }

  return (
    <div className="space-y-4">
      <Panel className="space-y-3 p-4">
        <p className="text-[11px] uppercase tracking-wider text-muted">Asistente de nutrición</p>
        <p className="text-sm text-muted">
          Objetivo: subir de peso de forma saludable y ganar músculo, con fuerza en el gym.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estatura (cm)">
            <input
              inputMode="decimal"
              value={me.heightCm ?? ""}
              onChange={(e) =>
                updateUser(me.id, { heightCm: e.target.value ? Number(e.target.value) : null })
              }
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 font-mono outline-none focus:border-accent"
            />
          </Field>
          <Field label="Peso (kg)">
            <input
              inputMode="decimal"
              value={me.weightKg ?? ""}
              onChange={(e) =>
                updateUser(me.id, { weightKg: e.target.value ? Number(e.target.value) : null })
              }
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 font-mono outline-none focus:border-accent"
            />
          </Field>
        </div>
        <p className="font-mono text-sm text-muted">
          {index != null ? `IMC ${index}` : "Completa estatura y peso"}
          {me.weightKg ? ` · ~${proteinTargetG(me.weightKg)} g proteína/día` : ""}
        </p>
      </Panel>

      <Panel className="space-y-3 p-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-lg font-medium">Registro de hoy</h2>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-10 rounded-xl border border-line bg-surface-2 px-3 text-sm outline-none focus:border-accent"
          />
        </div>
        <Field label="Qué comí (pégalo o escríbelo y lo ordeno)">
          <textarea
            value={dump}
            onChange={(e) => setDump(e.target.value)}
            rows={3}
            placeholder="Desayuné avena con huevos. Almuerzo: arroz y pollo…"
            className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 outline-none focus:border-accent"
          />
        </Field>
        {MEAL_SLOTS.map((slot) => (
          <Field key={slot.id} label={`${slot.label}:`}>
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
          Guardar comida
        </Button>
        {saved?.comment ? (
          <p className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-sm">
            {saved.comment}
          </p>
        ) : null}
      </Panel>

      <FailingCard />
      <PastDays />
    </div>
  );
}

function FailingCard() {
  const data = useGymStore();
  const report = nutritionInsights(data.foodDays, data.activeUserId, 14);
  return (
    <Panel className="space-y-2 p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted">En qué estás fallando</p>
      <p className="font-mono text-xs text-muted">
        {report.loggedDays} días con registro · {report.missedDays} sin anotar · últimos {report.lookback} días
      </p>
      <ul className="space-y-2 text-sm">
        {report.issues.map((issue) => (
          <li key={issue} className="rounded-xl border border-line bg-surface-2 px-3 py-2">
            {issue}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PastDays() {
  const data = useGymStore();
  const mine = [...(data.foodDays ?? [])]
    .filter((d) => d.userId === data.activeUserId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);
  if (mine.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted">Historial de comidas</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {mine.map((day) => (
          <li key={day.id} className="space-y-2 px-4 py-3">
            <p className="text-sm font-medium">{dayLabel(`${day.date}T12:00:00`)}</p>
            {MEAL_SLOTS.map((slot) => (
              <p key={slot.id} className="text-sm">
                <span className="text-muted">{slot.label}:</span>{" "}
                {day.meals[slot.id].trim() ? (
                  day.meals[slot.id]
                ) : (
                  <span className="text-danger">no registrado</span>
                )}
              </p>
            ))}
            {day.comment ? <p className="text-xs text-muted">{day.comment}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
