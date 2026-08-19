import type {
  BlockStation,
  Exercise,
  GymData,
  SetLog,
  Workout,
  WorkoutBlock,
} from "./types";

export type StationNode = BlockStation & {
  exercise: Exercise;
  sets: SetLog[];
};

export type BlockNode = WorkoutBlock & {
  stations: StationNode[];
};

export type WorkoutTree = Workout & {
  blocks: BlockNode[];
};

export function workoutTree(data: GymData, workoutId: string): WorkoutTree | null {
  const workout = data.workouts.find((w) => w.id === workoutId);
  if (!workout) return null;
  const blocks = data.blocks
    .filter((b) => b.workoutId === workoutId)
    .sort((a, b) => a.position - b.position)
    .map((block) => {
      const stations = data.stations
        .filter((s) => s.blockId === block.id)
        .sort((a, b) => a.position - b.position)
        .map((station) => {
          const exercise = data.exercises.find((e) => e.id === station.exerciseId);
          if (!exercise) {
            throw new Error(`Ejercicio no encontrado: ${station.exerciseId}`);
          }
          const sets = data.sets
            .filter((s) => s.stationId === station.id)
            .sort((a, b) => a.roundIndex - b.roundIndex || a.setIndex - b.setIndex);
          return { ...station, exercise, sets };
        });
      return { ...block, stations };
    });
  return { ...workout, blocks };
}

export function setVolume(set: SetLog): number {
  if (!set.completed || set.weightKg == null) return 0;
  const left = set.reps ?? 0;
  const right = set.repsRight ?? 0;
  const reps = right > 0 ? left + right : left;
  return set.weightKg * reps;
}

export function workoutVolume(data: GymData, workoutId: string): number {
  const tree = workoutTree(data, workoutId);
  if (!tree) return 0;
  return tree.blocks
    .flatMap((b) => b.stations)
    .flatMap((s) => s.sets)
    .reduce((sum, set) => sum + setVolume(set), 0);
}

export function formatSet(set: SetLog): string {
  const kg = set.weightKg == null ? "—" : `${set.weightKg} kg`;
  if (set.repsRight != null) {
    return `${kg} × ${set.reps ?? "—"}/${set.repsRight}`;
  }
  if (set.reps != null) return `${kg} × ${set.reps}`;
  if (set.durationSec != null) return `${set.durationSec}s`;
  return kg;
}
