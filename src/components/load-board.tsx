"use client";

import { Minus, Plus } from "lucide-react";
import { dayLabel } from "@/lib/format";
import { GROUP_LABELS, workingLoadBoard } from "@/lib/loads";
import { lastExerciseDate } from "@/lib/metrics";
import { personName } from "@/lib/people";
import { useOwnGym } from "@/lib/auth/use-own-gym";
import { useGymStore } from "@/lib/store";
import type { MuscleGroup } from "@/lib/types";
import { Button } from "./ui";

const GROUP_ORDER: MuscleGroup[] = [
  "legs",
  "chest",
  "back",
  "shoulders",
  "arms",
  "core",
  "other",
];

export function LoadBoard() {
  const data = useOwnGym();
  const bumpWorkingLoad = useGymStore((s) => s.bumpWorkingLoad);
  const rows = workingLoadBoard(data);

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    rows: rows.filter((row) => row.exercise.muscleGroup === group),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Tu carga de trabajo, de las series que marques. El ±2.5 kg mueve tu peso.
      </p>
      {grouped.map((section) => (
        <section key={section.group} className="overflow-hidden rounded-2xl border border-line">
          <h2 className="border-b border-line bg-surface px-4 py-2 text-xs uppercase tracking-wider text-muted">
            {GROUP_LABELS[section.group]}
          </h2>
          <ul className="divide-y divide-line">
            {section.rows.map((row) => {
              const mine = row.byUser[data.activeUserId];
              return (
                <li key={row.exercise.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{row.exercise.name}</p>
                      <div className="mt-1 space-y-0.5 text-xs text-muted">
                        {data.users.map((user) => {
                          const load = row.byUser[user.id];
                          const when = lastExerciseDate(data, user.id, row.exercise.id);
                          return (
                            <p key={user.id}>
                              <span className="text-foreground">{personName(user) || "Nombre"}:</span>{" "}
                              {load
                                ? `${load.weightKg} kg × ${load.reps}${
                                    load.repsRight != null ? `/${load.repsRight}` : ""
                                  }`
                                : "sin peso"}
                              {when ? ` · ${dayLabel(when)}` : ""}
                            </p>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex gap-2">
                        <Button
                          className="h-11 w-11 px-0"
                          onClick={() => bumpWorkingLoad(row.exercise.id, -2.5)}
                        >
                          <Minus size={16} />
                        </Button>
                        <Button
                          variant="primary"
                          className="h-11 w-11 px-0"
                          onClick={() => bumpWorkingLoad(row.exercise.id, 2.5)}
                        >
                          <Plus size={16} />
                        </Button>
                      </div>
                      <p className="font-mono text-sm tabular-nums">
                        {mine ? `${mine.weightKg} kg` : "sin peso"}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
