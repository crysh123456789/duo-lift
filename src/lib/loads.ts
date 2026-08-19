import type { GymData } from "./types";

export function loadKey(userId: string, exerciseId: string) {
  return `${userId}:${exerciseId}`;
}

export type WorkingLoad = {
  weightKg: number;
  reps: number;
  repsRight: number | null;
};

export function getWorkingLoad(
  data: Pick<GymData, "workingLoads" | "workouts" | "blocks" | "stations" | "sets">,
  userId: string,
  exerciseId: string,
): WorkingLoad | null {
  const saved = data.workingLoads?.[loadKey(userId, exerciseId)];
  if (saved) return saved;

  const workoutIds = new Set(
    data.workouts.filter((w) => w.userId === userId).map((w) => w.id),
  );
  const stationIds = data.stations
    .filter((s) => {
      if (s.exerciseId !== exerciseId) return false;
      const block = data.blocks.find((b) => b.id === s.blockId);
      return Boolean(block && workoutIds.has(block.workoutId));
    })
    .map((s) => s.id);

  const last = [...data.sets]
    .filter(
      (s) =>
        stationIds.includes(s.stationId) &&
        s.completed &&
        !s.isWarmup &&
        s.weightKg != null,
    )
    .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))[0];

  if (!last || last.weightKg == null) return null;
  return {
    weightKg: last.weightKg,
    reps: last.reps ?? 8,
    repsRight: last.repsRight,
  };
}

export function bumpKg(current: number | null, delta: number): number {
  const next = Math.round(((current ?? 0) + delta) * 2) / 2;
  return Math.max(0, next);
}

export const GROUP_LABELS: Record<string, string> = {
  legs: "Piernas",
  chest: "Pecho",
  back: "Espalda",
  shoulders: "Hombros",
  arms: "Brazos",
  core: "Core",
  other: "Otros",
};

export function workingLoadBoard(data: GymData) {
  return data.exercises
    .map((exercise) => ({
      exercise,
      byUser: Object.fromEntries(
        data.users.map((user) => [user.id, getWorkingLoad(data, user.id, exercise.id)]),
      ) as Record<string, WorkingLoad | null>,
    }))
    .filter((row) => data.users.some((user) => row.byUser[user.id]));
}
