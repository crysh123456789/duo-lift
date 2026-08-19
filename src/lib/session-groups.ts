import { inferSplitDay } from "./split";
import { todayStamp } from "./nutrition";
import type { GymData, Workout } from "./types";

export type SessionRow =
  | { kind: "pair"; key: string; date: string; title: string; workouts: [Workout, Workout] }
  | { kind: "solo"; key: string; workout: Workout };

function sessionKey(data: GymData, workout: Workout): string {
  const day = inferSplitDay(data, workout);
  const date = todayStamp(new Date(workout.startedAt));
  return `${date}:${day?.id ?? workout.title ?? "otro"}`;
}

export function groupDuoSessions(data: GymData, workouts: Workout[]): SessionRow[] {
  const completed = [...workouts]
    .filter((w) => w.status === "completed")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const buckets = new Map<string, Workout[]>();
  for (const w of completed) {
    const key = sessionKey(data, w);
    const list = buckets.get(key) ?? [];
    list.push(w);
    buckets.set(key, list);
  }

  const used = new Set<string>();
  const rows: SessionRow[] = [];

  for (const w of completed) {
    if (used.has(w.id)) continue;
    const key = sessionKey(data, w);
    const group = (buckets.get(key) ?? []).filter((item) => !used.has(item.id));
    const pair = pairFrom(group);
    if (pair) {
      used.add(pair[0].id);
      used.add(pair[1].id);
      const day = inferSplitDay(data, pair[0]);
      rows.push({
        kind: "pair",
        key: `${key}:${pair[0].id}`,
        date: pair[0].startedAt,
        title: day?.title ?? pair[0].title ?? "Entrenamiento",
        workouts: pair,
      });
      continue;
    }
    used.add(w.id);
    rows.push({ kind: "solo", key: w.id, workout: w });
  }

  return rows;
}

function pairFrom(group: Workout[]): [Workout, Workout] | null {
  if (group.length < 2) return null;
  const byUser = new Map<string, Workout>();
  for (const w of group) {
    const prev = byUser.get(w.userId);
    if (!prev || w.startedAt > prev.startedAt) byUser.set(w.userId, w);
  }
  const unique = [...byUser.values()];
  if (unique.length !== 2) return null;
  const sorted = unique.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return [sorted[0]!, sorted[1]!];
}
