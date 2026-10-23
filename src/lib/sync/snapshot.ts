import { normalizeFoodDay } from "@/lib/nutrition";
import { DEFAULT_REMINDERS } from "@/lib/reminders";
import type { GymData, ReminderSettings } from "@/lib/types";
import { stableStringify } from "./stable";

export function normalizeReminders(value: Partial<ReminderSettings> | null | undefined): ReminderSettings {
  const current = value ?? DEFAULT_REMINDERS;
  return {
    ...DEFAULT_REMINDERS,
    ...current,
    enabled: current.enabled ?? DEFAULT_REMINDERS.enabled,
    meals: { ...DEFAULT_REMINDERS.meals, ...(current.meals ?? {}) },
    gym: { ...DEFAULT_REMINDERS.gym, ...(current.gym ?? {}) },
    lastFired: { ...(current.lastFired ?? {}) },
  };
}

function byId<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/** Field order the store persists. `activeUserId` stays on the device. */
export function snapshotFromState(state: Partial<GymData> & Pick<GymData, "duo">): GymData {
  return canonicalize({
    users: state.users ?? [],
    duo: state.duo,
    members: state.members ?? [],
    exercises: state.exercises ?? [],
    workouts: state.workouts ?? [],
    blocks: state.blocks ?? [],
    stations: state.stations ?? [],
    sets: state.sets ?? [],
    reactions: state.reactions ?? [],
    workingLoads: state.workingLoads ?? {},
    foodDays: state.foodDays ?? [],
    reminders: normalizeReminders(state.reminders),
  });
}

export function canonicalize(data: GymData): GymData {
  const reminders = normalizeReminders(data.reminders);
  return {
    users: byId(data.users),
    duo: data.duo,
    members: [...data.members].sort(
      (a, b) => a.duoId.localeCompare(b.duoId) || a.userId.localeCompare(b.userId),
    ),
    exercises: byId(data.exercises),
    workouts: byId(data.workouts),
    blocks: byId(data.blocks),
    stations: byId(data.stations),
    sets: byId(data.sets),
    reactions: byId(data.reactions),
    workingLoads: sortRecord(data.workingLoads ?? {}),
    foodDays: byId((data.foodDays ?? []).map((day) => normalizeFoodDay(day))),
    reminders: {
      ...reminders,
      lastFired: sortRecord(reminders.lastFired),
    },
  };
}

export function sameSnapshot(
  left: GymData,
  right: GymData,
  opts?: { ignoreReminders?: boolean },
): boolean {
  if (opts?.ignoreReminders) {
    return stableStringify({ ...left, reminders: null }) === stableStringify({ ...right, reminders: null });
  }
  return stableStringify(left) === stableStringify(right);
}
