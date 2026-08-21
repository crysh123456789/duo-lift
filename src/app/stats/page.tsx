"use client";

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
import { bestWeight, formatKg, lastWorkout, volumeLastDays, weeklyVolume } from "@/lib/metrics";
import { whenLabel } from "@/lib/format";
import { personName } from "@/lib/people";
import { useGymStore } from "@/lib/store";

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
  const data = useGymStore();
  const volume = weeklyVolume(data, 4);
  const thisWeek = volume[volume.length - 1];
  const mine = lastWorkout(data, data.activeUserId);

  return (
    <div className="space-y-8">
      <PageTitle title="Progreso" />
      <div>
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Progreso</p>
        <h1 className="text-3xl font-medium tracking-tight">Esta semana</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Volumen de los dos y las alzas que importan: banca, hack y prensa.
          {mine
            ? ` Último entreno: ${whenLabel(mine.startedAt)} · ${mine.title ?? "sesión"}.`
            : ""}
        </p>
      </div>

      <section className="grid gap-3 md:grid-cols-2">
        {data.users.map((user, i) => {
          const weekKg = Number(thisWeek?.[user.id] ?? volumeLastDays(data, user.id, 7));
          const other = data.users.find((u) => u.id !== user.id);
          const otherKg = other ? Number(thisWeek?.[other.id] ?? 0) : 0;
          const lead = weekKg >= otherKg;
          return (
            <div key={user.id} className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm" style={{ color: COLORS[i] }}>
                {personName(user) || "Sin nombre"}
              </p>
              <p className="font-mono text-3xl tabular-nums">{formatKg(weekKg)} kg</p>
              <p className="text-xs text-muted">{lead ? "Va arriba esta semana" : "Persiguiendo"}</p>
            </div>
          );
        })}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-medium">Volumen semanal (kg)</h2>
        <p className="mb-3 text-xs text-muted">Semanas con dato, lunes a domingo.</p>
        <div className="h-64 rounded-2xl border border-line bg-surface p-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={volume}>
              <CartesianGrid stroke="#2d3224" vertical={false} />
              <XAxis dataKey="label" stroke="#9aa186" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#9aa186" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              {data.users.map((user, i) => (
                <Bar
                  key={user.id}
                  dataKey={user.id}
                  name={personName(user) || "Duo"}
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
              <div className="flex gap-4 font-mono text-sm tabular-nums">
                {data.users.map((user, i) => (
                  <span key={user.id} style={{ color: COLORS[i] }}>
                    {bestWeight(data, user.id, lift.id) ?? "—"} kg
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}