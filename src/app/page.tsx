"use client";

import Link from "next/link";
import { Button, Panel } from "@/components/ui";
import { dayLabel, relativeTime } from "@/lib/format";
import { GROUP_LABELS, workingLoadBoard } from "@/lib/loads";
import { foodDayFor, MEAL_SLOTS, todayStamp } from "@/lib/nutrition";
import {
  formatKg,
  lastWorkout,
  sessionSummary,
  volumeLastDays,
  workoutsLastDays,
} from "@/lib/metrics";
import { useGymStore } from "@/lib/store";
import { workoutVolume } from "@/lib/workout-tree";

const PALETTE = ["var(--me)", "var(--them)"];

export default function DashboardPage() {
  const data = useGymStore();
  const me = data.users.find((u) => u.id === data.activeUserId);
  const inProgress = data.workouts.find(
    (w) => w.userId === data.activeUserId && w.status === "in_progress",
  );

  const cards = data.users.map((user) => {
    const last = lastWorkout(data, user.id);
    return {
      user,
      sessions: workoutsLastDays(data, user.id, 7).length,
      volume: volumeLastDays(data, user.id, 7),
      last,
      summary: last ? sessionSummary(data, last.id) : "Sin entrenos aún",
    };
  });

  const feed = [...data.workouts]
    .filter((w) => w.status === "completed")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 8);

  const myLoads = workingLoadBoard(data)
    .map((row) => ({
      id: row.exercise.id,
      name: row.exercise.name,
      group: row.exercise.muscleGroup,
      load: row.byUser[data.activeUserId],
    }))
    .filter((row) => row.load);

  const todayFood = foodDayFor(data, data.activeUserId, todayStamp());
  const missingMeals = MEAL_SLOTS.filter((s) => !todayFood?.meals[s.id]?.trim()).map((s) => s.label);

  return (
    <div className="space-y-6">
      {missingMeals.length > 0 ? (
        <Panel className="border-accent/40 p-4">
          <p className="text-[11px] uppercase tracking-wider text-accent">Hoy</p>
          <p className="mt-1 text-sm">
            Falta registrar: {missingMeals.join(", ")}.
          </p>
          <Link href="/profile" className="mt-2 inline-block text-sm text-accent">
            Ir al diario
          </Link>
        </Panel>
      ) : null}
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Inicio</p>
          <h1 className="text-3xl font-medium tracking-tight">Hola, {me?.displayName}</h1>
        </div>
        <Link href="/workout/new">
          <Button variant="primary">{inProgress ? "Seguir sesión" : "Entrenar"}</Button>
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((card, i) => (
          <Panel key={card.user.id} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-medium">{card.user.displayName}</h2>
              <span
                className="text-[11px] uppercase tracking-wider"
                style={{ color: PALETTE[i] ?? PALETTE[0] }}
              >
                7 días
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="font-mono text-3xl tabular-nums">{card.sessions}</p>
                <p className="text-xs text-muted">entrenos</p>
              </div>
              <div>
                <p className="font-mono text-3xl tabular-nums">{formatKg(card.volume)}</p>
                <p className="text-xs text-muted">kg de volumen</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted">
              {card.last
                ? `Último ${relativeTime(card.last.startedAt)} · ${card.summary}`
                : card.summary}
            </p>
          </Panel>
        ))}
      </div>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 className="text-sm font-medium text-muted">Cargas que llevas</h2>
          <Link href="/history" className="text-xs text-accent">
            Ver registro
          </Link>
        </div>
        {myLoads.length === 0 ? (
          <p className="text-sm text-muted">Aún no hay pesos guardados.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {myLoads.slice(0, 8).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm">{row.name}</p>
                  <p className="text-[11px] text-muted">{GROUP_LABELS[row.group]}</p>
                </div>
                <p className="font-mono text-sm tabular-nums">
                  {row.load?.weightKg} kg × {row.load?.reps}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Actividad reciente</h2>
        {feed.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay sesiones cerradas.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {feed.map((w) => {
              const user = data.users.find((u) => u.id === w.userId);
              const fires = data.reactions.filter((r) => r.workoutId === w.id && r.kind === "fire").length;
              return (
                <li key={w.id}>
                  <Link
                    href={`/workout/${w.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        <span className="text-muted">{user?.displayName}</span>
                        {" · "}
                        {w.title ?? "Entrenamiento"}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {dayLabel(w.startedAt)} · {sessionSummary(data, w.id)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm tabular-nums">{formatKg(workoutVolume(data, w.id))} kg</p>
                      {fires > 0 ? <p className="text-[11px] text-accent">{fires} fuego</p> : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
