"use client";

import { Check, Minus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { DeleteSetConfirm, DeleteSetError, DeleteSetPending, finishSetDelete } from "@/components/logged-set-editor";
import { SET_COPY, SET_DELETE_ENABLED } from "@/lib/sets/edit";
import type { BlockNode } from "@/lib/workout-tree";
import { formatLoad } from "@/lib/copy";
import { getWorkingLoad } from "@/lib/loads";
import { bestWeight, lastLoggedSet } from "@/lib/metrics";
import { omitSeedHistory } from "@/lib/seed";
import { useGymStore } from "@/lib/store";
import { Button, NumberField } from "./ui";

export function StraightBlock({
  block,
  onLogged,
}: {
  block: BlockNode;
  onLogged?: () => void;
}) {
  const data = omitSeedHistory(useGymStore());
  const station = block.stations[0];
  const updateSet = useGymStore((s) => s.updateSet);
  const toggleSetComplete = useGymStore((s) => s.toggleSetComplete);
  const bumpStationWeight = useGymStore((s) => s.bumpStationWeight);
  const addSet = useGymStore((s) => s.addSet);
  const removeSet = useGymStore((s) => s.removeSet);
  const removeBlock = useGymStore((s) => s.removeBlock);
  const [deletePhase, setDeletePhase] = useState<{ id: string; phase: "confirm" | "deleting" | "error" } | null>(
    null,
  );

  async function confirmDelete(setId: string) {
    setDeletePhase({ id: setId, phase: "deleting" });
    const outcome = await finishSetDelete(() => removeSet(setId));
    if (outcome === "error") setDeletePhase({ id: setId, phase: "error" });
  }

  if (!station) return null;
  const unilateral = station.exercise.isUnilateral;
  const workout = data.workouts.find((w) => w.id === block.workoutId);
  const load = workout
    ? getWorkingLoad(data, workout.userId, station.exerciseId)
    : null;
  const last = workout
    ? lastLoggedSet(data, workout.userId, station.exerciseId, workout.startedAt)
    : null;
  const lastBest = workout ? (bestWeight(data, workout.userId, station.exerciseId) ?? 0) : 0;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted">Ejercicio</p>
          <h3 className="text-lg font-medium">{station.exercise.name}</h3>
          {last ? (
            <p className="mt-1 text-xs text-muted">
              La vez pasada: {formatLoad(last.weightKg, last.reps)}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => removeBlock(block.id)}
          className="text-muted hover:text-danger"
          aria-label="Quitar ejercicio"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-muted">Peso que llevas</p>
          <p className="font-mono text-xl tabular-nums">
            {load ? `${load.weightKg} kg` : station.exercise.equipment === "bodyweight" ? "cuerpo" : "sin peso"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <Button className="h-11 w-11 px-0" onClick={() => bumpStationWeight(station.id, -2.5)}>
              <Minus size={16} />
            </Button>
            <Button
              variant="primary"
              className="h-11 w-11 px-0"
              onClick={() => bumpStationWeight(station.id, 2.5)}
            >
              <Plus size={16} />
            </Button>
          </div>
          <p className="text-[10px] text-muted">±2.5 kg</p>
        </div>
      </div>

      <div className="space-y-2">
        {station.sets.map((set, i) => {
          const pr = set.completed && set.weightKg != null && set.weightKg > lastBest;
          return (
          <div
            key={set.id}
            className={`grid items-end gap-2 rounded-xl border px-2 py-2 ${
              set.completed ? "border-accent/40 bg-accent/5" : "border-line"
            } ${unilateral ? "grid-cols-[2rem_1fr_1fr_1fr_2.5rem]" : "grid-cols-[2rem_1fr_1fr_2.5rem]"}`}
          >
            <span className="pb-3 text-center font-mono text-xs text-muted">{i + 1}</span>
            <NumberField
              label="kg"
              value={set.weightKg}
              onChange={(v) => updateSet(set.id, { weightKg: v })}
            />
            <NumberField
              label={unilateral ? "reps L" : "reps"}
              value={set.reps}
              onChange={(v) => updateSet(set.id, { reps: v })}
            />
            {unilateral ? (
              <NumberField
                label="reps R"
                value={set.repsRight}
                onChange={(v) => updateSet(set.id, { repsRight: v })}
              />
            ) : null}
            <button
              type="button"
              onClick={() => {
                const wasDone = set.completed;
                toggleSetComplete(set.id);
                if (!wasDone) onLogged?.();
              }}
              className={`mb-1 grid h-12 w-11 min-h-11 min-w-11 place-items-center rounded-xl ${
                set.completed ? "bg-accent text-accent-ink" : "border border-line text-muted"
              }`}
              aria-label="Marcar serie"
            >
              <Check size={16} />
            </button>
            {pr ? (
              <p className="col-span-full text-[11px] text-accent">PR · superaste la carga previa</p>
            ) : null}
            {SET_DELETE_ENABLED && deletePhase?.id === set.id && deletePhase.phase === "confirm" ? (
              <div className="col-span-full">
                <DeleteSetConfirm onCancel={() => setDeletePhase(null)} onConfirm={() => void confirmDelete(set.id)} />
              </div>
            ) : null}
            {SET_DELETE_ENABLED && deletePhase?.id === set.id && deletePhase.phase === "deleting" ? (
              <div className="col-span-full">
                <DeleteSetPending />
              </div>
            ) : null}
            {SET_DELETE_ENABLED && deletePhase?.id === set.id && deletePhase.phase === "error" ? (
              <div className="col-span-full">
                <DeleteSetError
                  onCancel={() => setDeletePhase(null)}
                  onRetry={() => void confirmDelete(set.id)}
                />
              </div>
            ) : null}
            {SET_DELETE_ENABLED && deletePhase?.id !== set.id ? (
              <button
                type="button"
                onClick={() => setDeletePhase({ id: set.id, phase: "confirm" })}
                className="col-span-full inline-flex min-h-11 min-w-11 items-center rounded-xl px-3 text-left text-sm text-danger"
              >
                {SET_COPY.deleteSeries}
              </button>
            ) : null}
          </div>
          );
        })}
      </div>
      <Button className="mt-3 w-full" onClick={() => addSet(station.id, 1)}>
        <Plus size={16} /> Serie
      </Button>
    </section>
  );
}
