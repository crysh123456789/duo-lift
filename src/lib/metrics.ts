import {
  eachWeekOfInterval,
  format,
  startOfWeek,
  subWeeks,
} from "date-fns";
import { es } from "date-fns/locale";
import { whenLabel } from "./format";
import { omitDemo } from "./seed";
import { shiftStamp, todayStamp } from "./nutrition";
import { staleOpenWorkout, todayOpenWorkout } from "./session-date";
import type { GymData } from "./types";
import { workoutTree, workoutVolume } from "./workout-tree";

export function weeklyVolume(data: GymData, weekCount = 4) {
  data = omitDemo(data);
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

function chartUserId(data: GymData, workoutUserId: string): string | null {
  if (data.users.some((user) => user.id === workoutUserId)) return workoutUserId;
  if (data.users.length !== 1) return null;
  const orphans = new Set(
    data.workouts
      .map((row) => row.userId)
      .filter((id) => !data.users.some((user) => user.id === id)),
  );
  if (orphans.size === 1 && orphans.has(workoutUserId)) return data.users[0]?.id ?? null;
  return null;
}

/** Every calendar day from the oldest session through today, at least `dayCount` days. */
export function dailyVolume(data: GymData, dayCount = 14, now = new Date()) {
  data = omitDemo(data);
  const end = todayStamp(now);
  const windowStart = new Date(now);
  windowStart.setHours(12, 0, 0, 0);
  windowStart.setDate(windowStart.getDate() - (dayCount - 1));
  let start = todayStamp(windowStart);
  for (const workout of data.workouts) {
    if (workout.status === "abandoned") continue;
    const stamp = todayStamp(new Date(workout.startedAt));
    if (stamp < start) start = stamp;
  }
  if (start > end) start = end;

  const rows: Record<string, string | number>[] = [];
  for (let stamp = start, guard = 0; stamp <= end && guard < 4000; stamp = shiftStamp(stamp, 1), guard += 1) {
    const day = new Date(`${stamp}T12:00:00`);
    const volumes: Record<string, number> = {};
    for (const user of data.users) volumes[user.id] = 0;
    for (const workout of data.workouts) {
      if (workout.status === "abandoned") continue;
      if (todayStamp(new Date(workout.startedAt)) !== stamp) continue;
      const owner = chartUserId(data, workout.userId);
      if (!owner) continue;
      const draft = workout.status === "in_progress";
      volumes[owner] = (volumes[owner] ?? 0) + workoutVolume(data, workout.id, { draft });
    }
    const row: Record<string, string | number> = {
      label: whenLabel(day.toISOString(), now),
      stamp,
    };
    for (const user of data.users) {
      row[user.id] = Math.round(volumes[user.id] ?? 0);
    }
    rows.push(row);
  }
  return rows;
}

export function lastOpenOrCompleted(data: GymData, userId: string, now = new Date()) {
  data = omitDemo(data);
  return (
    todayOpenWorkout(data.workouts, userId, now) ??
    staleOpenWorkout(data.workouts, userId, now) ??
    lastWorkout(data, userId)
  );
}

export function workoutLifts(data: GymData, workoutId: string) {
  const tree = workoutTree(data, workoutId);
  if (!tree) return [];
  return tree.blocks.flatMap((block) =>
    block.stations.map((station) => {
      const sets = station.sets.filter((s) => !s.isWarmup && (s.weightKg != null || s.reps != null));
      const best = [...sets].sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0))[0];
      return {
        id: station.id,
        name: station.exercise.name,
        weightKg: best?.weightKg ?? null,
        reps: best?.reps ?? null,
      };
    }),
  );
}

export function maxWeightHistory(data: GymData, exerciseId: string) {
  data = omitDemo(data);
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
  data = omitDemo(data);
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

export function workoutsLastDays(data: GymData, userId: string, days: number, now = new Date()) {
  data = omitDemo(data);
  const cutoff = now.getTime() - days * 86400000;
  return data.workouts.filter(
    (w) => w.userId === userId && w.status === "completed" && new Date(w.startedAt).getTime() >= cutoff,
  );
}

export function volumeLastDays(data: GymData, userId: string, days: number, now = new Date()) {
  return workoutsLastDays(data, userId, days, now).reduce(
    (sum, w) => sum + workoutVolume(data, w.id),
    0,
  );
}

/** Ids on this card. A lone signed-in person also keeps rows still tagged with a legacy id. */
function ownedUserIds(data: GymData, userId: string): Set<string> {
  const ids = new Set([userId]);
  if (data.users.length !== 1 || data.users[0]?.id !== userId) return ids;
  const orphans = new Set(
    data.workouts.map((row) => row.userId).filter((id) => !data.users.some((user) => user.id === id)),
  );
  if (orphans.size === 1) ids.add([...orphans][0]!);
  return ids;
}

/** All completed sessions, plus the rolling week so a weekly figure can be labeled as such. */
export function personTrainingStats(data: GymData, userId: string, now = new Date()) {
  data = omitDemo(data);
  const ids = ownedUserIds(data, userId);
  const completed = data.workouts.filter((w) => ids.has(w.userId) && w.status === "completed");
  const week = completed.filter((w) => new Date(w.startedAt).getTime() >= now.getTime() - 7 * 86400000);
  const volume = (rows: typeof completed) => rows.reduce((sum, w) => sum + workoutVolume(data, w.id), 0);
  return {
    completed: completed.length,
    volume: volume(completed),
    weekCompleted: week.length,
    weekVolume: volume(week),
  };
}

export function lastWorkout(data: GymData, userId: string) {
  data = omitDemo(data);
  const ids = ownedUserIds(data, userId);
  return [...data.workouts]
    .filter((w) => ids.has(w.userId) && w.status === "completed")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

/** In-progress session dated today. A leftover from another day is not today's workout. */
export function activeWorkout(data: GymData, userId: string, now = new Date()) {
  data = omitDemo(data);
  return todayOpenWorkout(data.workouts, userId, now);
}

export function exercisesWithLogs(data: GymData) {
  data = omitDemo(data);
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
  data = omitDemo(data);
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
  data = omitDemo(data);
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
