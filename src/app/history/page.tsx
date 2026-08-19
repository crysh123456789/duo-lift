"use client";

import Link from "next/link";
import { useState } from "react";
import { LoadBoard } from "@/components/load-board";
import { formatKg, sessionSummary } from "@/lib/metrics";
import { dayLabel } from "@/lib/format";
import { useGymStore } from "@/lib/store";
import { workoutVolume } from "@/lib/workout-tree";

type Filter = "both" | "me" | "other";
type Tab = "sessions" | "loads";

export default function HistoryPage() {
  const data = useGymStore();
  const [filter, setFilter] = useState<Filter>("both");
  const [tab, setTab] = useState<Tab>("sessions");

  const rows = [...data.workouts]
    .filter((w) => w.status === "completed")
    .filter((w) => {
      if (filter === "me") return w.userId === data.activeUserId;
      if (filter === "other") return w.userId !== data.activeUserId;
      return true;
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Historial</p>
        <h1 className="text-3xl font-medium tracking-tight">Registro</h1>
      </div>
      <div className="flex gap-1 rounded-full border border-line bg-surface p-1">
        {(
          [
            ["sessions", "Sesiones"],
            ["loads", "Cargas"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`h-9 flex-1 rounded-full text-sm ${
              tab === id ? "bg-surface-2 text-foreground" : "text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "loads" ? (
        <LoadBoard />
      ) : (
        <>
          <div className="flex gap-1 rounded-full border border-line bg-surface p-1">
            {(
              [
                ["both", "Ambos"],
                ["me", "Yo"],
                ["other", "El otro"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`h-9 flex-1 rounded-full text-sm ${
                  filter === id ? "bg-surface-2 text-foreground" : "text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay sesiones cerradas.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {rows.map((w) => {
                const user = data.users.find((u) => u.id === w.userId);
                return (
                  <li key={w.id}>
                    <Link
                      href={`/workout/${w.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                    >
                      <div className="min-w-0">
                        <p className="truncate">
                          {w.title ?? "Entrenamiento"}
                          <span className="text-muted"> · {user?.displayName}</span>
                        </p>
                        <p className="truncate text-xs text-muted">
                          {dayLabel(w.startedAt)} · {sessionSummary(data, w.id)}
                        </p>
                      </div>
                      <p className="font-mono text-sm tabular-nums">
                        {formatKg(workoutVolume(data, w.id))} kg
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
