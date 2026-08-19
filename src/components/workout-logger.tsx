"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircuitBlock } from "@/components/circuit-block";
import { CircuitBuilder } from "@/components/circuit-builder";
import { ExercisePicker } from "@/components/exercise-picker";
import { PageTitle } from "@/components/page-title";
import { RestTimer } from "@/components/rest-timer";
import { StraightBlock } from "@/components/straight-block";
import { Button, Field, Panel } from "@/components/ui";
import { formatLoad } from "@/lib/copy";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getWorkingLoad } from "@/lib/loads";
import { activeWorkout, formatKg } from "@/lib/metrics";
import { splitExerciseIds, splitHeadline } from "@/lib/split";
import { useGymStore } from "@/lib/store";
import { workoutTree, workoutVolume } from "@/lib/workout-tree";

export function WorkoutLogger() {
  const router = useRouter();
  const data = useGymStore();
  const startSplitDay = useGymStore((s) => s.startSplitDay);
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
  const [restKey, setRestKey] = useState(0);

  const workout = activeWorkout(data, data.activeUserId);
  const tree = workout ? workoutTree(data, workout.id) : null;
  const { day, kicker } = splitHeadline(data, data.activeUserId);

  if (!workout || !tree) {
    const moves = splitExerciseIds(day).map((id) => data.exercises.find((e) => e.id === id)).filter(Boolean);
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <PageTitle title={kicker} />
        <div>
          <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Entrenar</p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight">{kicker}</h1>
          <p className="mt-2 text-sm text-muted">
            Un toque arma el día completo. El peso que llevas ya está puesto.
          </p>
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {moves.map((ex) => {
            if (!ex) return null;
            const load = getWorkingLoad(data, data.activeUserId, ex.id);
            return (
              <li key={ex.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="min-w-0 truncate text-sm">{ex.name}</p>
                <p className="shrink-0 font-mono text-sm tabular-nums text-muted">
                  {load ? formatLoad(load.weightKg, load.reps) : "sin peso aún"}
                </p>
              </li>
            );
          })}
        </ul>
        <Button
          variant="primary"
          className="h-12 w-full"
          onClick={() => startSplitDay(day.id)}
        >
          Armar {day.title.toLowerCase()}
        </Button>
      </div>
    );
  }

  const volume = workoutVolume(data, workout.id);
  const heading = workout.title || "Entrenamiento";

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageTitle title={`${heading} · ${format(new Date(workout.startedAt), "d MMM", { locale: es })}`} />
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">En curso</p>
          <h1 className="text-2xl font-medium tracking-tight">{heading}</h1>
          <p className="mt-1 font-mono text-sm tabular-nums text-muted">
            Carga de hoy: {formatKg(volume)} kg
          </p>
        </div>
        <Button variant="primary" onClick={() => setFinishing(true)}>
          Terminar
        </Button>
      </div>

      {restKey > 0 ? <RestTimer key={restKey} seconds={90} /> : null}

      {tree.blocks.map((block) =>
        block.kind === "circuit" ? (
          <CircuitBlock key={block.id} block={block} onLogged={() => setRestKey((n) => n + 1)} />
        ) : (
          <StraightBlock key={block.id} block={block} onLogged={() => setRestKey((n) => n + 1)} />
        ),
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => setPicker(true)}>Añadir varios</Button>
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
                  placeholder={heading}
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
                      title: title || heading,
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
