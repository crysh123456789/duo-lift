"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageTitle } from "@/components/page-title";
import { EX } from "@/lib/seed";
import { formatLoad } from "@/lib/copy";
import {
  bestWeight,
  dailyVolume,
  formatKg,
  lastOpenOrCompleted,
  volumeLastDays,
  weeklyVolume,
  workoutLifts,
} from "@/lib/metrics";
import { whenLabel } from "@/lib/format";
import { isSameSessionDay, staleOpenWorkout, unclosedBadge } from "@/lib/session-date";
import { personName } from "@/lib/people";
import { useOwnGym } from "@/lib/auth/use-own-gym";

const tooltipStyle = {
  background: "#151712",
  border: "1px solid #2d3224",
  borderRadius: 12,
  fontSize: 12,
};

const COLORS = ["#c8f542", "#7eb8ff"];

const LIFTS = [
  { id: EX.banca, name: "Banca" },
  { id: EX.hatch, name: "Hack" },
  { id: EX.prensa, name: "Prensa" },
];

export default function StatsPage() {
  const data = useOwnGym();
  const days = dailyVolume(data, 14);
  const volume = weeklyVolume(data, 4);
  const thisWeek = volume[volume.length - 1];
  const latest = lastOpenOrCompleted(data, data.activeUserId);
  const stale = staleOpenWorkout(data.workouts, data.activeUserId);
  const lifts = latest ? workoutLifts(data, latest.id) : [];
  const open = latest?.status === "in_progress";

  return (
    <div className="space-y-8">
      <PageTitle title="Progreso" />
      <div>
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Progreso</p>
        <h1 className="text-3xl font-medium tracking-tight">
          {latest ? `${latest.title ?? "Entrenamiento"} · ${whenLabel(latest.startedAt)}` : "Esta semana"}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Lo que acabas de mover, día a día, y las alzas grandes.
        </p>
        {stale && stale.id !== latest?.id ? (
          <p className="mt-2 text-sm text-accent">
            {stale.title ?? "Entrenamiento"} · {unclosedBadge(stale.startedAt)}
          </p>
        ) : null}
      </div>

      {latest ? (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="text-sm font-medium">
              {open && latest ? unclosedBadge(latest.startedAt) : "Última sesión"}
            </h2>
            {open && latest ? (
              <Link
                href={
                  isSameSessionDay(latest.startedAt)
                    ? "/workout/new"
                    : `/workout/new?seguir=${latest.id}`
                }
                className="min-h-11 text-xs text-accent"
              >
                Seguir y guardar
              </Link>
            ) : null}
          </div>
          {lifts.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay ejercicios en esa sesión.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {lifts.map((lift) => (
                <li key={lift.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <p className="text-sm">{lift.name}</p>
                  <p className="font-mono text-sm tabular-nums text-muted">
                    {lift.weightKg == null && lift.reps == null
                      ? "sin peso aún"
                      : formatLoad(lift.weightKg, lift.reps)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm text-accent">Esta semana</p>
        <p className="font-mono text-3xl tabular-nums">
          {formatKg(Number(thisWeek?.[data.activeUserId] ?? volumeLastDays(data, data.activeUserId, 7)))} kg
        </p>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium">Volumen por día (kg)</h2>
        <p className="mb-3 text-xs text-muted">
          Todas las fechas con sesión, también si sigue sin cerrar.
        </p>
        <div className="h-64 rounded-2xl border border-line bg-surface p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={days}>
              <CartesianGrid stroke="#2d3224" vertical={false} />
              <XAxis dataKey="label" stroke="#9aa186" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#9aa186" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              {data.users.map((user, i) => (
                <Bar
                  key={user.id}
                  dataKey={user.id}
                  name={personName(user) || "Tú"}
                  fill={COLORS[i] ?? COLORS[0]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium">Alzas grandes</h2>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {LIFTS.map((lift) => (
            <li key={lift.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="text-sm">{lift.name}</p>
              <p className="font-mono text-sm tabular-nums text-accent">
                {bestWeight(data, data.activeUserId, lift.id) ?? "—"} kg
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}