"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { UnclosedSessionCard } from "@/components/unclosed-session";
import { Panel } from "@/components/ui";
import { PageTitle } from "@/components/page-title";
import { whenLabel, relativeTime } from "@/lib/format";
import { foodDayFor, nextMealPrompt, todayStamp } from "@/lib/nutrition";
import { formatKg, homeDashboardState, lastWorkout, personTrainingStats, sessionSummary } from "@/lib/metrics";
import { personName } from "@/lib/people";
import { groupDuoSessions } from "@/lib/session-groups";
import { DATE_UPDATED, homeTrainCta, staleOpenWorkouts } from "@/lib/session-date";
import { splitHeadline } from "@/lib/split";
import { useOwnGym } from "@/lib/auth/use-own-gym";
import { isServerHydrated, subscribeSyncPhase } from "@/lib/sync/status";
import { workoutVolume } from "@/lib/workout-tree";

export default function DashboardPage() {
  const data = useOwnGym();
  const hydrated = useSyncExternalStore(subscribeSyncPhase, isServerHydrated, () => false);
  const [dateNotice, setDateNotice] = useState("");
  const me = data.users.find((u) => u.id === data.activeUserId);
  const myName = personName(me) || "tú";
  const openSessions = staleOpenWorkouts(data.workouts, data.activeUserId);
  const activeStats = personTrainingStats(data, data.activeUserId);
  const home = homeDashboardState(hydrated, {
    completed: activeStats.completed,
    volume: activeStats.volume,
    weekCompleted: activeStats.weekCompleted,
    weekVolume: activeStats.weekVolume,
    stale: openSessions,
  });
  const stale = home.stale;
  const cta = home.ready ? homeTrainCta(data.workouts, data.activeUserId) : null;
  const { kicker } = splitHeadline(data, data.activeUserId);

  const cards = data.users.map((user) => {
    const last = lastWorkout(data, user.id);
    const stats = user.id === data.activeUserId ? activeStats : personTrainingStats(data, user.id);
    const figures =
      user.id === data.activeUserId
        ? home
        : homeDashboardState(hydrated, {
            completed: stats.completed,
            volume: stats.volume,
            weekCompleted: stats.weekCompleted,
            weekVolume: stats.weekVolume,
            stale: [],
          });
    return {
      user,
      name: personName(user),
      sessions: figures.completed,
      volume: figures.volume,
      weekCompleted: figures.weekCompleted,
      weekVolume: figures.weekVolume,
      ready: figures.ready,
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
        {dateNotice && stale.length === 0 ? (
          <p className="mt-3 text-sm text-accent" role="status">
            {dateNotice}
          </p>
        ) : null}
        {cta ? (
          <Link
            href="/workout/new"
            className="mt-4 inline-flex h-12 min-h-12 w-full items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/90 sm:w-auto"
          >
            {cta}
          </Link>
        ) : null}
        {stale.length > 0 ? (
          <div className="mt-4 max-w-lg space-y-3">
            {stale.map((workout) => (
              <UnclosedSessionCard
                key={workout.id}
                workout={workout}
                onDateUpdated={() => setDateNotice(DATE_UPDATED)}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((card) => (
          <Panel key={card.user.id} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-medium">{card.name || "Ponle nombre en Perfil"}</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="font-mono text-3xl tabular-nums">{card.sessions ?? "—"}</p>
                <p className="text-xs text-muted">entrenos</p>
              </div>
              <div>
                <p className="font-mono text-3xl tabular-nums">
                  {card.volume == null ? "—" : formatKg(card.volume)}
                </p>
                <p className="text-xs text-muted">kg de volumen</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">
              Esta semana: {card.weekCompleted ?? "—"} entrenos ·{" "}
              {card.weekVolume == null ? "—" : formatKg(card.weekVolume)} kg
            </p>
            <p className="mt-4 text-sm text-muted">
              {card.ready
                ? card.last
                  ? `Último ${relativeTime(card.last.startedAt)} · ${card.summary}`
                  : card.summary
                : "Sincronizando…"}
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
                          {whenLabel(row.date)} · {names}
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
                        {whenLabel(w.startedAt)} · {sessionSummary(data, w.id)}
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