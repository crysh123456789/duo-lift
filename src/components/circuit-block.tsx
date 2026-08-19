"use client";

import { Check, Minus, Plus, Trash2 } from "lucide-react";
import type { BlockNode, StationNode } from "@/lib/workout-tree";
import { formatSet } from "@/lib/workout-tree";
import { getWorkingLoad } from "@/lib/loads";
import { useGymStore } from "@/lib/store";
import { Button, NumberField } from "./ui";

function firstOpenSet(block: BlockNode) {
  for (let round = 1; round <= block.targetRounds; round++) {
    for (const station of block.stations) {
      const set = station.sets.find((s) => s.roundIndex === round);
      if (set && !set.completed) return { round, station, set };
    }
  }
  return null;
}

export function CircuitBlock({ block }: { block: BlockNode }) {
  const data = useGymStore();
  const updateSet = useGymStore((s) => s.updateSet);
  const toggleSetComplete = useGymStore((s) => s.toggleSetComplete);
  const bumpStationWeight = useGymStore((s) => s.bumpStationWeight);
  const removeBlock = useGymStore((s) => s.removeBlock);
  const current = firstOpenSet(block);
  const workout = data.workouts.find((w) => w.id === block.workoutId);
  const currentLoad =
    current && workout
      ? getWorkingLoad(data, workout.userId, current.station.exerciseId)
      : null;
  const nextStation: StationNode | undefined = current
    ? block.stations.find((s) => s.position === current.station.position + 1) ??
      (current.round < block.targetRounds ? block.stations[0] : undefined)
    : undefined;

  return (
    <section className="rounded-2xl border border-accent/30 bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-accent">Circuito</p>
          <h3 className="text-lg font-medium">{block.name}</h3>
          <p className="text-sm text-muted">
            {current ? `Ronda ${current.round} de ${block.targetRounds}` : `${block.targetRounds} rondas completas`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => removeBlock(block.id)}
          className="text-muted hover:text-danger"
          aria-label="Quitar circuito"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <p className="mb-4 text-sm text-muted">
        {block.stations.map((s) => s.exercise.name).join(" → ")}
      </p>

      {current ? (
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <p className="text-[11px] uppercase tracking-wider text-accent">Ahora</p>
          <p className="mb-3 text-xl font-medium">{current.station.exercise.name}</p>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted">Peso que llevas</p>
              <p className="font-mono text-lg tabular-nums">
                {currentLoad ? `${currentLoad.weightKg} kg` : "—"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                className="h-10 w-10 px-0"
                onClick={() => bumpStationWeight(current.station.id, -2.5)}
              >
                <Minus size={16} />
              </Button>
              <Button
                variant="primary"
                className="h-10 w-10 px-0"
                onClick={() => bumpStationWeight(current.station.id, 2.5)}
              >
                <Plus size={16} />
              </Button>
            </div>
          </div>
          <div className={`grid gap-2 ${current.station.exercise.isUnilateral ? "grid-cols-3" : "grid-cols-2"}`}>
            <NumberField
              label="kg"
              value={current.set.weightKg}
              onChange={(v) => updateSet(current.set.id, { weightKg: v })}
            />
            <NumberField
              label={current.station.exercise.isUnilateral ? "reps L" : "reps"}
              value={current.set.reps}
              onChange={(v) => updateSet(current.set.id, { reps: v })}
            />
            {current.station.exercise.isUnilateral ? (
              <NumberField
                label="reps R"
                value={current.set.repsRight}
                onChange={(v) => updateSet(current.set.id, { repsRight: v })}
              />
            ) : null}
          </div>
          <Button
            variant="primary"
            className="mt-3 w-full"
            onClick={() => toggleSetComplete(current.set.id)}
          >
            <Check size={16} /> Registrar y seguir
          </Button>
          {nextStation ? (
            <p className="mt-2 text-center text-xs text-muted">Siguiente: {nextStation.exercise.name}</p>
          ) : (
            <p className="mt-2 text-center text-xs text-muted">Última estación de esta ronda</p>
          )}
        </div>
      ) : (
        <p className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
          Circuito cerrado. Las {block.targetRounds} rondas están registradas.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-2 font-medium">Ronda</th>
              {block.stations.map((s) => (
                <th key={s.id} className="py-2 font-medium">
                  {s.exercise.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: block.targetRounds }, (_, i) => i + 1).map((round) => (
              <tr key={round} className="border-t border-line">
                <td className="py-2 font-mono text-muted">{round}</td>
                {block.stations.map((station) => {
                  const set = station.sets.find((s) => s.roundIndex === round);
                  const isCurrent = current?.set.id === set?.id;
                  return (
                    <td key={station.id} className="py-2">
                      <span className={isCurrent ? "text-accent" : set?.completed ? "text-foreground" : "text-muted"}>
                        {set?.completed || (set && (set.weightKg != null || set.reps != null))
                          ? formatSet(set)
                          : "—"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
