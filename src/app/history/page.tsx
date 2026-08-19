"use client";

import Link from "next/link";
import { useState } from "react";
import { LoadBoard } from "@/components/load-board";
import { PageTitle } from "@/components/page-title";
import { formatKg, sessionSummary } from "@/lib/metrics";
import { dayLabel } from "@/lib/format";
import { personName } from "@/lib/people";
import { groupDuoSessions } from "@/lib/session-groups";
import { useGymStore } from "@/lib/store";
import { workoutVolume } from "@/lib/workout-tree";

type Tab = "sessions" | "loads";

export default function HistoryPage() {
  const data = useGymStore();
  const [tab, setTab] = useState<Tab>("sessions");
  const meName = personName(data.users.find((u) => u.id === data.activeUserId));
  const other = data.users.find((u) => u.id !== data.activeUserId);
  const otherName = personName(other);
  const [person, setPerson] = useState<"both" | "me" | "them">("both");

  const filtered = data.workouts.filter((w) => {
    if (w.status !== "completed") return false;
    if (person === "me") return w.userId === data.activeUserId;
    if (person === "them") return w.userId !== data.activeUserId;
    return true;
  });
  const rows = groupDuoSessions(data, person === "both" ? data.workouts : filtered);

  return (
    <div className="space-y-5">
      <PageTitle title={tab === "loads" ? "Cargas" : "Historial"} />
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
                ["me", meName || "Tú"],
                ["them", otherName || "Nombre"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPerson(id)}
                className={`h-9 flex-1 rounded-full text-sm ${
                  person === id ? "bg-surface-2 text-foreground" : "text-muted"
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
              {rows.map((row) => {
                if (row.kind === "pair" && person === "both") {
                  const vol = row.workouts.reduce((sum, w) => sum + workoutVolume(data, w.id), 0);
                  return (
                    <li key={row.key}>
                      <Link
                        href={`/workout/${row.workouts[0].id}`}
                        className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                      >
                        <div className="min-w-0">
                          <p className="truncate">
                            {row.title}
                            <span className="text-muted"> · juntos</span>
                          </p>
                          <p className="truncate text-xs text-muted">{dayLabel(row.date)}</p>
                        </div>
                        <p className="font-mono text-sm tabular-nums">{formatKg(vol)} kg</p>
                      </Link>
                    </li>
                  );
                }
                const w = row.kind === "pair" ? row.workouts.find((item) =>
                  person === "me" ? item.userId === data.activeUserId : item.userId !== data.activeUserId,
                ) ?? row.workouts[0] : row.workout;
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
                          <span className="text-muted"> · {personName(user)}</span>
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