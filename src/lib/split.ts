import { EX, omitSeedHistory } from "./seed";
import { todayStamp } from "./nutrition";
import type { GymData, Workout } from "./types";

export type SplitStation = {
  exerciseId: string;
  kind: "straight" | "circuit";
};

export type SplitCircuit = {
  name: string;
  exerciseIds: string[];
  rounds: number;
};

export type SplitDay = {
  id: "pierna" | "pecho" | "gluteos" | "abdomen-hombros" | "espalda-biceps";
  title: string;
  circuits: SplitCircuit[];
  straightIds: string[];
};

export const SPLIT: SplitDay[] = [
  {
    id: "pierna",
    title: "Pierna",
    circuits: [
      {
        name: "Abductores → Zancadas → Hack",
        exerciseIds: [EX.abductores, EX.zancadas, EX.hatch],
        rounds: 4,
      },
    ],
    straightIds: [EX.prensa, EX.femoral],
  },
  {
    id: "pecho",
    title: "Pecho y tríceps",
    circuits: [],
    straightIds: [
      EX.banca,
      EX.declinado,
      EX.inclinada,
      EX.fondos,
      EX.aperturas,
      EX.poleaTriceps,
      EX.copa,
    ],
  },
  {
    id: "gluteos",
    title: "Glúteos",
    circuits: [],
    straightIds: [EX.bulgaras, EX.deadlift, EX.hipThrust, EX.goblet],
  },
  {
    id: "abdomen-hombros",
    title: "Abdomen y hombros",
    circuits: [],
    straightIds: [EX.absDisco, EX.rodilla, EX.oblicuos, EX.laterales, EX.frontales, EX.facePull],
  },
  {
    id: "espalda-biceps",
    title: "Espalda y bíceps",
    circuits: [
      {
        name: "Jalón + Invertida",
        exerciseIds: [EX.jalon, EX.invertida],
        rounds: 3,
      },
    ],
    straightIds: [EX.remo, EX.remoManc, EX.curlInclinado, EX.martillo, EX.scott],
  },
];

export function splitExerciseIds(day: SplitDay): string[] {
  return [...day.circuits.flatMap((c) => c.exerciseIds), ...day.straightIds];
}

export function splitDayByTitle(title: string | null | undefined): SplitDay | null {
  if (!title?.trim()) return null;
  const needle = title.trim().toLowerCase();
  const exact = SPLIT.find((d) => d.title.toLowerCase() === needle);
  if (exact) return exact;
  return (
    SPLIT.find(
      (d) =>
        d.title.toLowerCase().startsWith(`${needle} `) ||
        d.title.toLowerCase().startsWith(`${needle} y`) ||
        needle.startsWith(d.title.toLowerCase().split(" y ")[0] ?? ""),
    ) ?? null
  );
}

export function inferSplitDay(data: GymData, workout: Workout): SplitDay | null {
  const byTitle = splitDayByTitle(workout.title);
  if (byTitle) return byTitle;

  const blockIds = data.blocks.filter((b) => b.workoutId === workout.id).map((b) => b.id);
  const exerciseIds = new Set(
    data.stations.filter((s) => blockIds.includes(s.blockId)).map((s) => s.exerciseId),
  );
  if (exerciseIds.size === 0) return null;

  let best: SplitDay | null = null;
  let bestHits = 0;
  for (const day of SPLIT) {
    const ids = splitExerciseIds(day);
    const hits = ids.filter((id) => exerciseIds.has(id)).length;
    if (hits > bestHits) {
      best = day;
      bestHits = hits;
    }
  }
  return bestHits >= 2 ? best : null;
}

export function lastCompletedWorkout(data: GymData): Workout | undefined {
  data = omitSeedHistory(data);
  return [...data.workouts]
    .filter((w) => w.status === "completed")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

export function nextSplitDay(data: GymData): SplitDay {
  const last = lastCompletedWorkout(data);
  if (!last) return SPLIT[0]!;
  const day = inferSplitDay(data, last);
  if (!day) return SPLIT[0]!;
  const idx = SPLIT.findIndex((d) => d.id === day.id);
  return SPLIT[(idx + 1) % SPLIT.length]!;
}

export function trainedToday(data: GymData, userId: string, now = new Date()): boolean {
  data = omitSeedHistory(data);
  const stamp = todayStamp(now);
  return data.workouts.some(
    (w) =>
      w.userId === userId &&
      w.status === "completed" &&
      todayStamp(new Date(w.startedAt)) === stamp,
  );
}

export function splitHeadline(data: GymData, userId: string): { day: SplitDay; kicker: string } {
  const day = nextSplitDay(data);
  const kicker = trainedToday(data, userId) ? `Siguiente: ${day.title}` : `Hoy toca: ${day.title}`;
  return { day, kicker };
}
