"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { exerciseByName, exercisesWithLogs, maxWeightHistory, weeklyVolume } from "@/lib/metrics";
import { useGymStore } from "@/lib/store";

const tooltipStyle = {
  background: "#151712",
  border: "1px solid #2d3224",
  borderRadius: 12,
  fontSize: 12,
};

const COLORS = ["#c8f542", "#7eb8ff"];

export default function StatsPage() {
  const data = useGymStore();
  const logged = exercisesWithLogs(data);
  const hatch = exerciseByName(data, "Cuclillas Hack");
  const [exerciseId, setExerciseId] = useState<string>(hatch?.id ?? logged[0]?.id ?? "");
  const selected = data.exercises.find((e) => e.id === exerciseId) ?? logged[0];

  const volume = weeklyVolume(data, 6);
  const maxHist = selected ? maxWeightHistory(data, selected.id) : {};

  const labels = new Set<string>();
  for (const user of data.users) {
    for (const p of maxHist[user.id] ?? []) labels.add(p.date);
  }
  const lineRows = [...labels].map((label) => {
    const row: Record<string, string | number | undefined> = { label };
    for (const user of data.users) {
      row[user.id] = maxHist[user.id]?.find((p) => p.date === label)?.kg;
    }
    return row;
  });

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Progreso</p>
        <h1 className="text-3xl font-medium tracking-tight">Comparar</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Volumen semanal de ambos y peso máximo por ejercicio. Las curvas solo
          aparecen en sesiones donde ese movimiento se entrenó.
        </p>
      </div>

      <section>
        <h2 className="mb-1 text-sm font-medium">Volumen semanal (kg)</h2>
        <p className="mb-3 text-xs text-muted">Suma de peso × repeticiones. Semanas de lunes a domingo.</p>
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
                  name={user.displayName}
                  fill={COLORS[i] ?? COLORS[0]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Peso máximo (kg)</h2>
            <p className="text-xs text-muted">Serie más pesada de la sesión, sin calentamientos.</p>
          </div>
          <select
            value={selected?.id ?? ""}
            onChange={(e) => setExerciseId(e.target.value)}
            className="h-10 rounded-xl border border-line bg-surface-2 px-3 text-sm outline-none focus:border-accent"
          >
            {(logged.length > 0 ? logged : data.exercises).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div className="h-64 rounded-2xl border border-line bg-surface p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineRows}>
              <CartesianGrid stroke="#2d3224" vertical={false} />
              <XAxis dataKey="label" stroke="#9aa186" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#9aa186" fontSize={11} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
              {data.users.map((user, i) => (
                <Line
                  key={user.id}
                  type="monotone"
                  dataKey={user.id}
                  name={user.displayName}
                  stroke={COLORS[i] ?? COLORS[0]}
                  strokeWidth={2}
                  dot
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
