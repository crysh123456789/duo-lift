"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircuitBlock } from "@/components/circuit-block";
import { CircuitBuilder } from "@/components/circuit-builder";
import { ExercisePicker } from "@/components/exercise-picker";
import { StraightBlock } from "@/components/straight-block";
import { Button, Field, Panel } from "@/components/ui";
import { activeWorkout, formatKg } from "@/lib/metrics";
import { useGymStore } from "@/lib/store";
import { workoutTree, workoutVolume } from "@/lib/workout-tree";

export function WorkoutLogger() {
  const router = useRouter();
  const data = useGymStore();
  const startWorkout = useGymStore((s) => s.startWorkout);
  const finishWorkout = useGymStore((s) => s.finishWorkout);
  const abandonWorkout = useGymStore((s) => s.abandonWorkout);
  const addStraightBlocks = useGymStore((s) => s.addStraightBlocks);
  const addCircuitBlock = useGymStore((s) => s.addCircuitBlock);
  const [picker, setPicker] = useState(false);
  const [circuit, setCircuit] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [rpe, setRpe] = useState<number>(7);

  const workout = activeWorkout(data, data.activeUserId);
  const tree = workout ? workoutTree(data, workout.id) : null;

  if (!workout || !tree) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Sesión</p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight">¿Entrenamos?</h1>
        <p className="mt-3 text-sm text-muted">
          Empieza y añade de golpe todos los de pierna, pecho o el grupo que toque.
          El peso que lleves se recuerda para la próxima.
        </p>
        <Button
          variant="primary"
          className="mt-8 h-12 w-full max-w-xs"
          onClick={() => startWorkout()}
        >
          Empezar entrenamiento
        </Button>
      </div>
    );
  }

  const volume = workoutVolume(data, workout.id);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">En curso</p>
          <h1 className="text-2xl font-medium tracking-tight">Entrenamiento</h1>
          <p className="mt-1 font-mono text-sm tabular-nums text-muted">
            Carga de hoy: {formatKg(volume)} kg
          </p>
        </div>
        <Button variant="primary" onClick={() => setFinishing(true)}>
          Terminar
        </Button>
      </div>

      {tree.blocks.map((block) =>
        block.kind === "circuit" ? (
          <CircuitBlock key={block.id} block={block} />
        ) : (
          <StraightBlock key={block.id} block={block} />
        ),
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="primary" onClick={() => setPicker(true)}>
          Añadir varios
        </Button>
        <Button onClick={() => setCircuit(true)}>Añadir circuito</Button>
      </div>
      <button
        type="button"
        onClick={() => void abandonWorkout(workout.id)}
        className="w-full text-center text-xs text-muted hover:text-danger"
      >
        Descartar sesión
      </button>

      {picker ? (
        <ExercisePicker
          title="Añadir el día de hoy"
          mode="multi"
          onPickMany={(list) => {
            addStraightBlocks(
              workout.id,
              list.map((ex) => ex.id),
            );
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      ) : null}

      {circuit ? (
        <CircuitBuilder
          onCreate={(payload) => {
            addCircuitBlock(workout.id, payload);
            setCircuit(false);
          }}
          onClose={() => setCircuit(false)}
        />
      ) : null}

      {finishing ? (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-3 md:place-items-center">
          <Panel className="w-full max-w-lg p-4">
            <h2 className="mb-4 text-sm font-medium">Cerrar sesión</h2>
            <div className="space-y-3">
              <Field label="Título">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Tren inferior, empujes…"
                  className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
                />
              </Field>
              <Field label="Esfuerzo percibido (1–10)">
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={rpe}
                  onChange={(e) => setRpe(Number(e.target.value))}
                  className="w-full accent-[var(--accent)]"
                />
                <p className="font-mono text-sm">{rpe}</p>
              </Field>
              <Field label="Notas">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 outline-none focus:border-accent"
                />
              </Field>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => setFinishing(false)}>
                  Seguir
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => {
                    finishWorkout(workout.id, {
                      title,
                      notes,
                      perceivedExertion: rpe,
                    });
                    router.push(`/workout/${workout.id}`);
                  }}
                >
                  Guardar
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
