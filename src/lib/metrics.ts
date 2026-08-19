import {
  eachWeekOfInterval,
  format,
  startOfWeek,
  subWeeks,
} from "date-fns";
import { es } from "date-fns/locale";
import type { GymData } from "./types";
import { workoutTree, workoutVolume } from "./workout-tree";

export function weeklyVolume(data: GymData, weekCount = 4) {
  const end = new Date();
  const start = startOfWeek(subWeeks(end, weekCount - 1), { weekStartsOn: 1 });
  const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 1 });
  const rows = weeks.map((weekStart) => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const volumes: Record<string, number> = {};
    for (const user of data.users) volumes[user.id] = 0;
    for (const w of data.workouts) {
      if (w.status !== "completed") continue;
      const t = new Date(w.startedAt).getTime();
      if (t < weekStart.getTime() || t >= weekEnd.getTime()) continue;
      volumes[w.userId] = (volumes[w.userId] ?? 0) + workoutVolume(data, w.id);
    }
    const row: Record<string, string | number> = {
      label: format(weekStart, "d MMM", { locale: es }),
    };
    for (const user of data.users) {
      row[user.id] = Math.round(volumes[user.id] ?? 0);
    }
    return row;
  });
  const firstData = rows.findIndex((row) =>
    data.users.some((user) => Number(row[user.id] ?? 0) > 0),
  );
  if (firstData <= 0) return rows;
  return rows.slice(firstData);
}

export function maxWeightHistory(data: GymData, exerciseId: string) {
  const byUser: Record<string, { date: string; kg: number }[]> = {};
  for (const user of data.users) byUser[user.id] = [];
  const completed = data.workouts
    .filter((w) => w.status === "completed")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  for (const workout of completed) {
    const tree = workoutTree(data, workout.id);
    if (!tree) continue;
    let max: number | null = null;
    for (const block of tree.blocks) {
      for (const station of block.stations) {
        if (station.exerciseId !== exerciseId) continue;
        for (const set of station.sets) {
          if (!set.completed || set.isWarmup || set.weightKg == null) continue;
          max = max == null ? set.weightKg : Math.max(max, set.weightKg);
        }
      }
    }
    if (max != null) {
      byUser[workout.userId]?.push({
        date: format(new Date(workout.startedAt), "d MMM", { locale: es }),
        kg: max,
      });
    }
  }
  return byUser;
}

export function bestWeight(data: GymData, userId: string, exerciseId: string): number | null {
  let max: number | null = null;
  for (const workout of data.workouts) {
    if (workout.userId !== userId || workout.status !== "completed") continue;
    const tree = workoutTree(data, workout.id);
    if (!tree) continue;
    for (const station of tree.blocks.flatMap((b) => b.stations)) {
      if (station.exerciseId !== exerciseId) continue;
      for (const set of station.sets) {
        if (!set.completed || set.isWarmup || set.weightKg == null) continue;
        max = max == null ? set.weightKg : Math.max(max, set.weightKg);
      }
    }
  }
  return max;
}

export function workoutsLastDays(data: GymData, userId: string, days: number) {
  const cutoff = Date.now() - days * 86400000;
  return data.workouts.filter(
    (w) => w.userId === userId && w.status === "completed" && new Date(w.startedAt).getTime() >= cutoff,
  );
}

export function volumeLastDays(data: GymData, userId: string, days: number) {
  return workoutsLastDays(data, userId, days).reduce(
    (sum, w) => sum + workoutVolume(data, w.id),
    0,
  );
}

export function lastWorkout(data: GymData, userId: string) {
  return [...data.workouts]
    .filter((w) => w.userId === userId && w.status === "completed")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

export function activeWorkout(data: GymData, userId: string) {
  return data.workouts.find((w) => w.userId === userId && w.status === "in_progress");
}

export function exercisesWithLogs(data: GymData) {
  const ids = new Set<string>();
  for (const station of data.stations) {
    const has = data.sets.some((s) => s.stationId === station.id && s.completed);
    if (has) ids.add(station.exerciseId);
  }
  return data.exercises.filter((e) => ids.has(e.id));
}

export function exerciseByName(data: GymData, name: string) {
  return data.exercises.find((e) => e.name.toLowerCase() === name.toLowerCase());
}

export function formatKg(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`;
}

export function sessionSummary(data: GymData, workoutId: string): string {
  const tree = workoutTree(data, workoutId);
  if (!tree || tree.blocks.length === 0) return "Sin ejercicios";
  const names = tree.blocks.flatMap((b) =>
    b.kind === "circuit"
      ? [b.name ?? "Circuito"]
      : b.stations.map((s) => s.exercise.name),
  );
  return names.slice(0, 3).join(" · ");
}

export function lastLoggedSet(
  data: GymData,
  userId: string,
  exerciseId: string,
  beforeIso?: string,
): { weightKg: number | null; reps: number | null; repsRight: number | null } | null {
  const completed = data.workouts
    .filter((w) => w.userId === userId && w.status === "completed")
    .filter((w) => !beforeIso || w.startedAt < beforeIso)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  for (const workout of completed) {
    const tree = workoutTree(data, workout.id);
    if (!tree) continue;
    const sets = tree.blocks
      .flatMap((b) => b.stations)
      .filter((s) => s.exerciseId === exerciseId)
      .flatMap((s) => s.sets)
      .filter((s) => s.completed && !s.isWarmup)
      .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
    const last = sets[0];
    if (last) {
      return { weightKg: last.weightKg, reps: last.reps, repsRight: last.repsRight };
    }
  }
  return null;
}

export function isPersonalRecord(
  data: GymData,
  userId: string,
  exerciseId: string,
  weightKg: number | null,
): boolean {
  if (weightKg == null) return false;
  const prev = bestWeight(data, userId, exerciseId);
  return prev == null || weightKg > prev;
}

export function lastExerciseDate(data: GymData, userId: string, exerciseId: string): string | null {
  let latest: string | null = null;
  for (const workout of data.workouts) {
    if (workout.userId !== userId || workout.status !== "completed") continue;
    const has = data.blocks.some((block) => {
      if (block.workoutId !== workout.id) return false;
      return data.stations.some((station) => {
        if (station.blockId !== block.id || station.exerciseId !== exerciseId) return false;
        return data.sets.some((set) => set.stationId === station.id && set.completed);
      });
    });
    if (has && (!latest || workout.startedAt > latest)) latest = workout.startedAt;
  }
  return latest;
}
