"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CircuitBlock } from "@/components/circuit-block";
import { CircuitBuilder } from "@/components/circuit-builder";
import { ExercisePicker } from "@/components/exercise-picker";
import { PageTitle } from "@/components/page-title";
import { RestTimer } from "@/components/rest-timer";
import { SessionDateField } from "@/components/session-date-field";
import { StraightBlock } from "@/components/straight-block";
import { UnclosedSessionCard } from "@/components/unclosed-session";
import { Button, Field, Panel } from "@/components/ui";
import { formatLoad } from "@/lib/copy";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { getWorkingLoad } from "@/lib/loads";
import { formatKg } from "@/lib/metrics";
import { todayStamp } from "@/lib/nutrition";
import {
  CTA_CLOSE,
  DATE_UPDATED,
  UNCLOSED_TITLE,
  isSameSessionDay,
  isValidStamp,
  sessionStamp,
  staleOpenWorkouts,
  todayOpenWorkout,
} from "@/lib/session-date";
import {
  SPLIT,
  splitExerciseIds,
  splitHeadline,
  type SplitDay,
} from "@/lib/split";
import { useGymStore } from "@/lib/store";
import { workoutTree, workoutVolume } from "@/lib/workout-tree";

export function WorkoutLogger() {
  const router = useRouter();
  const params = useSearchParams();
  const seguirId = params.get("seguir");
  const data = useGymStore();
  const startSplitDay = useGymStore((s) => s.startSplitDay);
  const finishWorkout = useGymStore((s) => s.finishWorkout);
  const abandonWorkout = useGymStore((s) => s.abandonWorkout);
  const setWorkoutDate = useGymStore((s) => s.setWorkoutDate);
  const addStraightBlocks = useGymStore((s) => s.addStraightBlocks);
  const addCircuitBlock = useGymStore((s) => s.addCircuitBlock);
  const suggested = splitHeadline(data, data.activeUserId);
  const [pickedId, setPickedId] = useState<SplitDay["id"]>(suggested.day.id);
  const [sessionDate, setSessionDate] = useState(todayStamp);
  const [picker, setPicker] = useState(false);
  const [circuit, setCircuit] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [rpe, setRpe] = useState<number>(7);
  const [restKey, setRestKey] = useState(0);
  const [dateNotice, setDateNotice] = useState("");

  const explicit = seguirId
    ? data.workouts.find(
        (workout) =>
          workout.id === seguirId &&
          workout.userId === data.activeUserId &&
          workout.status === "in_progress",
      )
    : undefined;
  const todayOpen = todayOpenWorkout(data.workouts, data.activeUserId);
  const stale = staleOpenWorkouts(data.workouts, data.activeUserId);
  const workout = explicit ?? (stale.length > 0 && !todayOpen ? undefined : todayOpen);
  const tree = workout ? workoutTree(data, workout.id) : null;
  const otherStale = stale.filter((item) => item.id !== workout?.id);
  const day = SPLIT.find((item) => item.id === pickedId) ?? suggested.day;

  function applyDate(id: string, stamp: string) {
    if (!setWorkoutDate(id, stamp)) return;
    setDateNotice(DATE_UPDATED);
    router.replace(`/workout/new?seguir=${id}`);
  }

  if (!workout || !tree) {
    if (stale.length > 0) {
      return (
        <div className="mx-auto max-w-lg space-y-5">
          <PageTitle title={UNCLOSED_TITLE} />
          <div>
            <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Entrenar</p>
            <h1 className="mt-2 text-3xl font-medium tracking-tight">{suggested.kicker}</h1>
          </div>
          <div className="space-y-3">
            {stale.map((item) => (
              <UnclosedSessionCard
                key={item.id}
                workout={item}
                onDateUpdated={() => setDateNotice(DATE_UPDATED)}
              />
            ))}
          </div>
        </div>
      );
    }

    const moves = splitExerciseIds(day)
      .map((id) => data.exercises.find((exercise) => exercise.id === id))
      .filter(Boolean);
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <PageTitle title={suggested.kicker} />
        <div>
          <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Entrenar</p>
          <h1 className="mt-2 text-3xl font-medium tracking-tight">{suggested.kicker}</h1>
          <p className="mt-2 text-sm text-muted">
            Eso es lo que sigue en el split. Si hoy toca otro grupo, elígelo y se arma ese.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SPLIT.map((item) => {
            const on = item.id === day.id;
            const hint = item.id === suggested.day.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPickedId(item.id)}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  on ? "bg-accent text-accent-ink" : "border border-line text-muted"
                }`}
              >
                {item.title}
                {hint && !on ? " · toca" : ""}
              </button>
            );
          })}
        </div>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {moves.map((exercise) => {
            if (!exercise) return null;
            const load = getWorkingLoad(data, data.activeUserId, exercise.id);
            return (
              <li key={exercise.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="min-w-0 truncate text-sm">{exercise.name}</p>
                <p className="shrink-0 font-mono text-sm tabular-nums text-muted">
                  {load ? formatLoad(load.weightKg, load.reps) : "sin peso aún"}
                </p>
              </li>
            );
          })}
        </ul>
        <SessionDateField
          value={sessionDate}
          onChange={(stamp) => {
            if (isValidStamp(stamp)) setSessionDate(stamp);
          }}
        />
        <Button
          variant="primary"
          className="h-12 min-h-12 w-full"
          onClick={() => {
            const id = startSplitDay(day.id, { date: sessionDate });
            if (id) router.replace(`/workout/new?seguir=${id}`);
          }}
        >
          Armar {day.title.toLowerCase()}
        </Button>
      </div>
    );
  }

  const volume = workoutVolume(data, workout.id);
  const heading = workout.title || day.title || "Entrenamiento";
  const sameDay = isSameSessionDay(workout.startedAt);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageTitle title={`${heading} · ${format(new Date(workout.startedAt), "d MMM", { locale: es })}`} />
      {otherStale.length > 0 ? (
        <div className="space-y-3">
          {otherStale.map((item) => (
            <UnclosedSessionCard key={item.id} workout={item} />
          ))}
        </div>
      ) : null}
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">En curso</p>
          <h1 className="text-2xl font-medium tracking-tight">{heading}</h1>
          <p className="mt-1 font-mono text-sm tabular-nums text-muted">
            {sameDay ? `Carga de hoy: ${formatKg(volume)} kg` : `Carga: ${formatKg(volume)} kg`}
          </p>
        </div>
        <Button variant="primary" className="min-h-11" onClick={() => setFinishing(true)}>
          Terminar
        </Button>
      </div>

      <SessionDateField
        value={sessionStamp(workout.startedAt)}
        notice={dateNotice}
        onChange={(stamp) => applyDate(workout.id, stamp)}
      />

      {restKey > 0 ? <RestTimer key={restKey} seconds={90} /> : null}

      {tree.blocks.map((block) =>
        block.kind === "circuit" ? (
          <CircuitBlock key={block.id} block={block} onLogged={() => setRestKey((n) => n + 1)} />
        ) : (
          <StraightBlock key={block.id} block={block} onLogged={() => setRestKey((n) => n + 1)} />
        ),
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button className="min-h-11" onClick={() => setPicker(true)}>
          Añadir varios
        </Button>
        <Button className="min-h-11" onClick={() => setCircuit(true)}>
          Añadir circuito
        </Button>
      </div>
      <button
        type="button"
        onClick={() => {
          abandonWorkout(workout.id);
          setDateNotice("");
          router.replace("/workout/new");
        }}
        className="min-h-11 w-full text-center text-sm text-danger"
      >
        {CTA_CLOSE}
      </button>

      {picker ? (
        <ExercisePicker
          title="Añadir ejercicios"
          mode="multi"
          onPickMany={(list) => {
            addStraightBlocks(
              workout.id,
              list.map((exercise) => exercise.id),
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
                <Button className="min-h-11 flex-1" onClick={() => setFinishing(false)}>
                  Seguir
                </Button>
                <Button
                  variant="primary"
                  className="min-h-11 flex-1"
                  onClick={() => {
                    finishWorkout(workout.id, {
                      title: title.trim(),
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
