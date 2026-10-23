"use client";

import Link from "next/link";
import { useState } from "react";
import { LoadBoard } from "@/components/load-board";
import { PageTitle } from "@/components/page-title";
import { formatKg, sessionSummary } from "@/lib/metrics";
import { whenLabel } from "@/lib/format";
import { unclosedBadge } from "@/lib/session-date";
import { personName } from "@/lib/people";
import { groupDuoSessions } from "@/lib/session-groups";
import { useOwnGym } from "@/lib/auth/use-own-gym";
import { workoutVolume } from "@/lib/workout-tree";

type Tab = "sessions" | "loads";

export default function HistoryPage() {
  const data = useOwnGym();
  const [tab, setTab] = useState<Tab>("sessions");

  const open = data.workouts.filter((w) => w.status === "in_progress");
  const filtered = data.workouts.filter((w) => w.status === "completed");
  const rows = groupDuoSessions(data, filtered);

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
          {open.length === 0 && rows.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay sesiones cerradas.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {open.map((w) => {
                const user = data.users.find((u) => u.id === w.userId);
                return (
                  <li key={w.id}>
                    <Link
                      href={
                        w.userId === data.activeUserId
                          ? `/workout/new?seguir=${w.id}`
                          : `/workout/${w.id}`
                      }
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface"
                    >
                      <div className="min-w-0">
                        <p className="truncate">{w.title ?? "Entrenamiento"}</p>
                        <p className="mt-1 text-xs text-accent">{unclosedBadge(w.startedAt)}</p>
                        <p className="truncate text-xs text-muted">{personName(user)}</p>
                      </div>
                      <p className="text-xs text-accent">Seguir</p>
                    </Link>
                  </li>
                );
              })}
              {rows.map((row) => {
                const w = row.kind === "pair"
                  ? row.workouts.find((item) => item.userId === data.activeUserId) ?? row.workouts[0]
                  : row.workout;
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
                          {whenLabel(w.startedAt)} · {sessionSummary(data, w.id)}
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