"use client";

import { useMemo, useState } from "react";
import type { Exercise, MuscleGroup } from "@/lib/types";
import { addExercisesLabel } from "@/lib/copy";
import { getWorkingLoad } from "@/lib/loads";
import { useGymStore } from "@/lib/store";
import { Button, Field, Panel } from "./ui";

const GROUPS: { id: MuscleGroup | "all"; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "legs", label: "Piernas" },
  { id: "chest", label: "Pecho" },
  { id: "back", label: "Espalda" },
  { id: "shoulders", label: "Hombros" },
  { id: "arms", label: "Brazos" },
  { id: "core", label: "Core" },
];

export function ExercisePicker({
  title,
  mode = "single",
  onPick,
  onPickMany,
  onClose,
}: {
  title: string;
  mode?: "single" | "multi";
  onPick?: (exercise: Exercise) => void;
  onPickMany?: (exercises: Exercise[]) => void;
  onClose: () => void;
}) {
  const data = useGymStore();
  const exercises = data.exercises;
  const addCustom = useGymStore((s) => s.addCustomExercise);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<MuscleGroup | "all">(mode === "multi" ? "legs" : "all");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [unilateral, setUnilateral] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return exercises.filter((e) => {
      if (group !== "all" && e.muscleGroup !== group) return false;
      if (query && !e.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [exercises, q, group]);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 md:place-items-center">
      <Panel className="flex max-h-[88dvh] w-full max-w-lg flex-col">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">{title}</h2>
          <button type="button" onClick={onClose} className="text-sm text-muted">
            Cerrar
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4">
          <input
            autoFocus={mode === "single"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar ejercicio"
            className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
          />
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setGroup(g.id)}
                className={`rounded-full px-3 py-1 text-xs ${
                  group === g.id ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          {mode === "multi" ? (
            <button
              type="button"
              className="text-xs text-accent"
              onClick={() => setSelected(filtered.map((e) => e.id))}
            >
              Seleccionar todos los visibles
            </button>
          ) : null}
          <ul className="divide-y divide-line rounded-xl border border-line">
            {filtered.map((ex) => {
              const load = getWorkingLoad(data, data.activeUserId, ex.id);
              const on = selected.includes(ex.id);
              return (
                <li key={ex.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (mode === "multi") toggle(ex.id);
                      else onPick?.(ex);
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-surface-2 ${
                      on ? "bg-accent/10" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block">{ex.name}</span>
                      <span className="text-[11px] text-muted">
                        {load
                          ? `Llevas ${load.weightKg} kg × ${load.reps}`
                          : "Sin peso guardado todavía"}
                      </span>
                    </span>
                    {mode === "multi" ? (
                      <span
                        className={`grid h-5 w-5 place-items-center rounded border text-[10px] ${
                          on
                            ? "border-accent bg-accent text-accent-ink"
                            : "border-line text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                    ) : (
                      <span className="text-[11px] uppercase tracking-wider text-muted">
                        {ex.isUnilateral ? "unilateral" : ex.equipment}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {creating ? (
            <div className="space-y-3 rounded-xl border border-line p-3">
              <Field label="Nombre">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={unilateral}
                  onChange={(e) => setUnilateral(e.target.checked)}
                />
                Unilateral (zancadas, etc.)
              </label>
              <Button
                variant="primary"
                className="w-full"
                disabled={newName.trim().length < 2}
                onClick={() => {
                  const id = addCustom({
                    name: newName,
                    muscleGroup: group === "all" ? "other" : group,
                    isUnilateral: unilateral,
                  });
                  const created = useGymStore.getState().exercises.find((e) => e.id === id);
                  if (!created) return;
                  if (mode === "multi") {
                    setSelected((prev) => [...prev, created.id]);
                    setCreating(false);
                    setNewName("");
                  } else {
                    onPick?.(created);
                  }
                }}
              >
                Crear y usar
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="text-sm text-accent"
            >
              + Crear ejercicio custom
            </button>
          )}
        </div>
        {mode === "multi" ? (
          <div className="border-t border-line p-3">
            <Button
              variant="primary"
              className="w-full"
              disabled={selected.length === 0}
              onClick={() => {
                const chosen = selected
                  .map((id) => exercises.find((e) => e.id === id))
                  .filter((e): e is Exercise => Boolean(e));
                onPickMany?.(chosen);
              }}
            >
              {addExercisesLabel(selected.length)}
            </Button>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
