"use client";

import Link from "next/link";
import { Button, Panel } from "@/components/ui";
import { PageTitle } from "@/components/page-title";
import { dayLabel, relativeTime } from "@/lib/format";
import { foodDayFor, nextMealPrompt, todayStamp } from "@/lib/nutrition";
import {
  formatKg,
  lastWorkout,
  sessionSummary,
  volumeLastDays,
  workoutsLastDays,
} from "@/lib/metrics";
import { personName } from "@/lib/people";
import { groupDuoSessions } from "@/lib/session-groups";
import { splitHeadline } from "@/lib/split";
import { useGymStore } from "@/lib/store";
import { workoutVolume } from "@/lib/workout-tree";

const PALETTE = ["var(--me)", "var(--them)"];

export default function DashboardPage() {
  const data = useGymStore();
  const me = data.users.find((u) => u.id === data.activeUserId);
  const myName = personName(me) || "tú";
  const inProgress = data.workouts.find(
    (w) => w.userId === data.activeUserId && w.status === "in_progress",
  );
  const { day, kicker } = splitHeadline(data, data.activeUserId);

  const cards = data.users.map((user) => {
    const last = lastWorkout(data, user.id);
    return {
      user,
      name: personName(user),
      sessions: workoutsLastDays(data, user.id, 7).length,
      volume: volumeLastDays(data, user.id, 7),
      last,
      summary: last ? sessionSummary(data, last.id) : "Sin entrenos aún",
    };
  });

  const feed = groupDuoSessions(data, data.workouts).slice(0, 6);
  const todayFood = foodDayFor(data, data.activeUserId, todayStamp());
  const mealPrompt = nextMealPrompt(todayFood?.meals);

  return (
    <div className="space-y-6">
      <PageTitle title={kicker} />
      <div>
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Inicio</p>
        <h1 className="text-3xl font-medium tracking-tight">Hola, {myName}</h1>
        <p className="mt-1 text-lg">{kicker}</p>
        <Link href="/workout/new" className="mt-4 block">
          <Button variant="primary" className="h-12 w-full sm:w-auto">
            {inProgress ? "Seguir sesión" : `Armar ${day.title.toLowerCase()}`}
          </Button>
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((card, i) => (
          <Panel key={card.user.id} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-medium">{card.name || "Ponle nombre en Perfil"}</h2>
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

      {mealPrompt ? (
        <Panel className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-accent">Diario</p>
          <p className="mt-1 text-lg">{mealPrompt.question}</p>
          <Link href="/nutrition" className="mt-3 inline-block text-sm text-accent">
            Anotar
          </Link>
        </Panel>
      ) : (
        <Panel className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-accent">Diario</p>
          <p className="mt-1 text-sm text-muted">Hoy ya está anotado. Si hay un extra, súmalo.</p>
          <Link href="/nutrition" className="mt-3 inline-block text-sm text-accent">
            Ver diario
          </Link>
        </Panel>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Actividad reciente</h2>
        {feed.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay sesiones cerradas.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {feed.map((row) => {
              if (row.kind === "pair") {
                const vol = row.workouts.reduce((sum, w) => sum + workoutVolume(data, w.id), 0);
                const names = row.workouts
                  .map((w) => personName(data.users.find((u) => u.id === w.userId)))
                  .filter(Boolean)
                  .join(" y ");
                const fires = row.workouts.reduce(
                  (n, w) => n + data.reactions.filter((r) => r.workoutId === w.id && r.kind === "fire").length,
                  0,
                );
                return (
                  <li key={row.key}>
                    <Link
                      href={`/workout/${row.workouts[0].id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">
                          {row.title}
                          <span className="text-muted"> · juntos</span>
                        </p>
                        <p className="truncate text-xs text-muted">
                          {dayLabel(row.date)} · {names}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm tabular-nums">{formatKg(vol)} kg</p>
                        {fires > 0 ? <p className="text-[11px] text-accent">{fires} fuego</p> : null}
                      </div>
                    </Link>
                  </li>
                );
              }
              const w = row.workout;
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
                        <span className="text-muted">{personName(user)}</span>
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