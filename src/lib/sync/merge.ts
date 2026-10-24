import { collapseFoodDays, MEAL_SLOTS, normalizeMealLog } from "@/lib/nutrition";
import {
  KCAL_TARGET_MAX,
  KCAL_TARGET_MIN,
  PROTEIN_TARGET_MAX,
  PROTEIN_TARGET_MIN,
  clampDailyTarget,
} from "@/lib/nutrition";
import { createSeed } from "@/lib/seed";
import { workoutClock } from "@/lib/session-date";
import type { FoodDay, GymData, ReminderSettings, User, Workout } from "@/lib/types";
import { canonicalize, normalizeReminders, sameSnapshot } from "./snapshot";
import { sameValue, stableStringify } from "./stable";
import { isTombstoneEntity, type Tombstone, type TombstoneEntity } from "./types";

type MergeOptions = {
  seed?: GymData;
  /** Hash of the last snapshot this device successfully synced, keyed by entity:id. */
  ack?: Record<string, string>;
  /** False when the server has no reminder row yet, so the phone keeps its own alarms. */
  remindersFromServer?: boolean;
  /**
   * Until this phone has a server ack, every local row stays as-is.
   * Remote-only rows can still be added. Remote tombstones are not applied here;
   * the caller omits them until the upload has been acknowledged.
   */
  preferLocal?: boolean;
};

const LIST_ENTITIES = [
  "workouts",
  "blocks",
  "stations",
  "sets",
  "reactions",
  "exercises",
  "foodDays",
] as const;

type ListEntity = (typeof LIST_ENTITIES)[number];
type ListKey = {
  workouts: GymData["workouts"][number];
  blocks: GymData["blocks"][number];
  stations: GymData["stations"][number];
  sets: GymData["sets"][number];
  reactions: GymData["reactions"][number];
  exercises: GymData["exercises"][number];
  foodDays: FoodDay;
};

function droppedIds(tombstones: Tombstone[], entity: TombstoneEntity): Set<string> {
  return new Set(tombstones.filter((row) => row.entity === entity).map((row) => row.id));
}

function chooseRow<T>(
  local: T | undefined,
  remote: T | undefined,
  seed: T | undefined,
  ackHash: string | undefined,
  time: (row: T) => string,
  preferLocal = false,
): T | undefined {
  if (!local) return remote;
  if (!remote) return local;
  if (preferLocal || sameValue(local, remote)) return local;
  // Untouched seed on this phone should not clobber the other phone's copy.
  if (seed && sameValue(local, seed)) return remote;
  const localHash = stableStringify(local);
  if (ackHash && localHash === ackHash) return remote;
  if (ackHash && stableStringify(remote) === ackHash) return local;
  return time(remote) > time(local) ? remote : local;
}

function mergeList<E extends ListEntity>(
  entity: E,
  local: ListKey[E][],
  remote: ListKey[E][],
  seed: ListKey[E][],
  tombstones: Tombstone[],
  ack: Record<string, string>,
  preferLocal: boolean,
  time: (row: ListKey[E]) => string,
): ListKey[E][] {
  const dropped = droppedIds(tombstones, entity);
  const seedById = new Map(seed.map((row) => [row.id, row]));
  const localById = new Map(local.map((row) => [row.id, row]));
  const remoteById = new Map(remote.map((row) => [row.id, row]));
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const out: ListKey[E][] = [];
  for (const id of ids) {
    if (dropped.has(id)) continue;
    const chosen = chooseRow(
      localById.get(id),
      remoteById.get(id),
      seedById.get(id),
      ack[`${entity}:${id}`],
      time,
      preferLocal,
    );
    if (chosen) out.push(chosen);
  }
  return out;
}

function mergeFired(local: Record<string, string>, remote: Record<string, string>) {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  const out: Record<string, string> = {};
  for (const key of keys) {
    const left = local[key];
    const right = remote[key];
    if (!left) out[key] = right ?? "";
    else if (!right) out[key] = left;
    else out[key] = left > right ? left : right;
  }
  return out;
}

function mergeReminders(
  local: ReminderSettings,
  remote: ReminderSettings,
  seed: ReminderSettings,
  ack: Record<string, string>,
  authoritative: boolean,
  preferLocal: boolean,
): ReminderSettings {
  const normalizedLocal = normalizeReminders(local);
  if (preferLocal || !authoritative) return normalizedLocal;
  const normalizedRemote = normalizeReminders(remote);
  const chosen =
    chooseRow(normalizedLocal, normalizedRemote, normalizeReminders(seed), ack.reminders, () => "") ??
    normalizedLocal;
  return normalizeReminders({
    ...chosen,
    lastFired: mergeFired(normalizedLocal.lastFired, normalizedRemote.lastFired),
  });
}

/**
 * Union local and remote. Never drops a local-only row unless a tombstone names it.
 * Seed rows this phone has not edited yield to the remote copy.
 */
export function mergeRemoteSnapshot(
  local: GymData,
  remote: GymData | null,
  tombstones: Tombstone[],
  options?: MergeOptions,
): GymData {
  const seed = options?.seed ?? createSeed();
  const ack = options?.ack ?? {};
  const preferLocal = options?.preferLocal === true;
  if (!remote) {
    return canonicalize(applyTombstones(local, tombstones));
  }

  const mergedUsers = mergeUsers(local, remote, seed, ack, preferLocal);
  const duo =
    chooseRow(local.duo, remote.duo, seed.duo, ack["duo"], (row) => row.createdAt, preferLocal) ?? local.duo;

  return canonicalize({
    users: mergedUsers,
    duo,
    members: mergeMembers(local, remote, seed, tombstones, ack, preferLocal),
    exercises: mergeList(
      "exercises",
      local.exercises,
      remote.exercises,
      seed.exercises,
      tombstones,
      ack,
      preferLocal,
      () => "",
    ),
    workouts: reconcileClosedWorkouts(
      local.workouts,
      remote.workouts,
      mergeList(
        "workouts",
        local.workouts,
        remote.workouts,
        seed.workouts,
        tombstones,
        ack,
        preferLocal,
        (row) => workoutClock(row),
      ),
    ),
    blocks: mergeList("blocks", local.blocks, remote.blocks, seed.blocks, tombstones, ack, preferLocal, () => ""),
    stations: mergeList(
      "stations",
      local.stations,
      remote.stations,
      seed.stations,
      tombstones,
      ack,
      preferLocal,
      () => "",
    ),
    sets: mergeList(
      "sets",
      local.sets,
      remote.sets,
      seed.sets,
      tombstones,
      ack,
      preferLocal,
      (row) => row.loggedAt,
    ),
    reactions: mergeList(
      "reactions",
      local.reactions,
      remote.reactions,
      seed.reactions,
      tombstones,
      ack,
      preferLocal,
      (row) => row.createdAt,
    ),
    workingLoads: mergeLoads(local, remote, seed, tombstones, ack, preferLocal),
    foodDays: stripMealItems(
      mergeList(
        "foodDays",
        collapseFoodDays(local.foodDays ?? []),
        collapseFoodDays(remote.foodDays ?? []),
        seed.foodDays ?? [],
        tombstones,
        ack,
        preferLocal,
        (row) => row.updatedAt,
      ),
      tombstones,
    ),
    reminders: mergeReminders(
      local.reminders,
      remote.reminders,
      seed.reminders,
      ack,
      options?.remindersFromServer !== false,
      preferLocal,
    ),
  });
}

function applyTombstones(local: GymData, tombstones: Tombstone[]): GymData {
  const drop = (entity: TombstoneEntity) => droppedIds(tombstones, entity);
  const workouts = local.workouts.filter((row) => !drop("workouts").has(row.id));
  const blocks = local.blocks.filter((row) => !drop("blocks").has(row.id));
  const stations = local.stations.filter((row) => !drop("stations").has(row.id));
  const sets = local.sets.filter((row) => !drop("sets").has(row.id));
  const reactions = local.reactions.filter((row) => !drop("reactions").has(row.id));
  const exercises = local.exercises.filter((row) => !drop("exercises").has(row.id));
  const foodDays = stripMealItems(
    (local.foodDays ?? []).filter((row) => !drop("foodDays").has(row.id)),
    tombstones,
  );
  const loadDrop = drop("workingLoads");
  const workingLoads = Object.fromEntries(
    Object.entries(local.workingLoads ?? {}).filter(([key]) => !loadDrop.has(key)),
  );
  const memberDrop = drop("members");
  const members = local.members.filter((row) => !memberDrop.has(`${row.duoId}:${row.userId}`));
  return { ...local, workouts, blocks, stations, sets, reactions, exercises, foodDays, workingLoads, members };
}

/**
 * A null on the phone must not hide a goal that was set on the server.
 * Only a newer edit on this phone (including a clear) beats the server clock.
 */
function mergeTarget(
  local: number | null | undefined,
  remote: number | null | undefined,
  localEditAt: string | null | undefined,
  remoteAt: string | null | undefined,
  max: number,
  min: number,
): number | null {
  const localValue = clampDailyTarget(local, max, min);
  const remoteValue = clampDailyTarget(remote, max, min);
  if (localEditAt && (!remoteAt || localEditAt > remoteAt)) return localValue;
  if (remoteValue != null) return remoteValue;
  if (
    localEditAt &&
    remoteAt &&
    localEditAt <= remoteAt &&
    remoteValue == null
  ) {
    return null;
  }
  return localValue;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A null phone value does not hide a height or weight stored on the server. */
function mergePresentNumber(
  local: number | null | undefined,
  remote: number | null | undefined,
  localEditAt: string | null | undefined,
  remoteAt: string | null | undefined,
): number | null {
  const localValue = finiteOrNull(local);
  const remoteValue = finiteOrNull(remote);
  if (localValue != null && localEditAt && (!remoteAt || localEditAt > remoteAt)) return localValue;
  if (remoteValue != null) return remoteValue;
  return localValue;
}

function withServerTargets(chosen: User, local: User | undefined, remote: User | undefined): User {
  const remoteAt = remote?.targetsUpdatedAt ?? null;
  const remoteProfileAt = remote?.profileUpdatedAt ?? null;
  return {
    ...chosen,
    heightCm: mergePresentNumber(local?.heightCm, remote?.heightCm, local?.profileEditedAt, remoteProfileAt),
    weightKg: mergePresentNumber(local?.weightKg, remote?.weightKg, local?.profileEditedAt, remoteProfileAt),
    profileUpdatedAt: remoteProfileAt ?? local?.profileUpdatedAt ?? null,
    profileEditedAt: local?.profileEditedAt ?? null,
    proteinTargetG: mergeTarget(
      local?.proteinTargetG,
      remote?.proteinTargetG,
      local?.proteinTargetUpdatedAt,
      remoteAt,
      PROTEIN_TARGET_MAX,
      PROTEIN_TARGET_MIN,
    ),
    kcalTarget: mergeTarget(
      local?.kcalTarget,
      remote?.kcalTarget,
      local?.kcalTargetUpdatedAt,
      remoteAt,
      KCAL_TARGET_MAX,
      KCAL_TARGET_MIN,
    ),
    targetsUpdatedAt: remoteAt ?? local?.targetsUpdatedAt ?? null,
    proteinTargetUpdatedAt: local?.proteinTargetUpdatedAt ?? null,
    kcalTargetUpdatedAt: local?.kcalTargetUpdatedAt ?? null,
  };
}

/** Copies merged goals onto the phone rows before an upload. */
export function usersWithServerTargets(local: User[], merged: User[]): User[] {
  const byId = new Map(merged.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const next = local.map((row) => {
    seen.add(row.id);
    const fromServer = byId.get(row.id);
    if (!fromServer) return row;
    const serverClock = fromServer.targetsUpdatedAt ?? null;
    const profileClock = fromServer.profileUpdatedAt ?? null;
    const keepProtein = Boolean(row.proteinTargetUpdatedAt && (!serverClock || row.proteinTargetUpdatedAt > serverClock));
    const keepKcal = Boolean(row.kcalTargetUpdatedAt && (!serverClock || row.kcalTargetUpdatedAt > serverClock));
    const keepProfile = Boolean(row.profileEditedAt && (!profileClock || row.profileEditedAt > profileClock));
    return {
      ...row,
      heightCm: keepProfile && row.heightCm != null ? row.heightCm : (fromServer.heightCm ?? row.heightCm ?? null),
      weightKg: keepProfile && row.weightKg != null ? row.weightKg : (fromServer.weightKg ?? row.weightKg ?? null),
      proteinTargetG: keepProtein ? (row.proteinTargetG ?? null) : (fromServer.proteinTargetG ?? null),
      kcalTarget: keepKcal ? (row.kcalTarget ?? null) : (fromServer.kcalTarget ?? null),
      targetsUpdatedAt: serverClock ?? row.targetsUpdatedAt ?? null,
      profileUpdatedAt: profileClock ?? row.profileUpdatedAt ?? null,
      proteinTargetUpdatedAt: row.proteinTargetUpdatedAt ?? fromServer.proteinTargetUpdatedAt ?? null,
      kcalTargetUpdatedAt: row.kcalTargetUpdatedAt ?? fromServer.kcalTargetUpdatedAt ?? null,
      profileEditedAt: row.profileEditedAt ?? fromServer.profileEditedAt ?? null,
    };
  });
  for (const row of merged) {
    if (!seen.has(row.id)) next.push(row);
  }
  return next;
}

function mergeUsers(
  local: GymData,
  remote: GymData,
  seed: GymData,
  ack: Record<string, string>,
  preferLocal: boolean,
) {
  const seedById = new Map(seed.users.map((row) => [row.id, row]));
  const localById = new Map(local.users.map((row) => [row.id, row]));
  const remoteById = new Map(remote.users.map((row) => [row.id, row]));
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const out = [];
  for (const id of ids) {
    const localUser = localById.get(id);
    const remoteUser = remoteById.get(id);
    const chosen = chooseRow(
      localUser,
      remoteUser,
      seedById.get(id),
      ack[`users:${id}`],
      (row) => row.createdAt,
      preferLocal,
    );
    if (chosen) out.push(withServerTargets(chosen, localUser, remoteUser));
  }
  return out;
}

/**
 * A session the server already closed is not still open on the phone
 * unless this phone edited it after that close.
 */
function reconcileClosedWorkouts(local: Workout[], remote: Workout[], merged: Workout[]): Workout[] {
  const localById = new Map(local.map((row) => [row.id, row]));
  const remoteById = new Map(remote.map((row) => [row.id, row]));
  return merged.map((row) => {
    const left = localById.get(row.id);
    const right = remoteById.get(row.id);
    if (!left || !right) return row;
    if (left.status !== "in_progress") return row;
    if (right.status !== "completed" && right.status !== "abandoned") return row;
    if (workoutClock(left) > workoutClock(right)) return row;
    return { ...row, status: right.status, endedAt: right.endedAt };
  });
}

function mergeMembers(
  local: GymData,
  remote: GymData,
  seed: GymData,
  tombstones: Tombstone[],
  ack: Record<string, string>,
  preferLocal: boolean,
) {
  const dropped = droppedIds(tombstones, "members");
  const key = (row: GymData["members"][number]) => `${row.duoId}:${row.userId}`;
  const seedById = new Map(seed.members.map((row) => [key(row), row]));
  const localById = new Map(local.members.map((row) => [key(row), row]));
  const remoteById = new Map(remote.members.map((row) => [key(row), row]));
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const out = [];
  for (const id of ids) {
    if (dropped.has(id)) continue;
    const chosen = chooseRow(
      localById.get(id),
      remoteById.get(id),
      seedById.get(id),
      ack[`members:${id}`],
      () => "",
      preferLocal,
    );
    if (chosen) out.push(chosen);
  }
  return out;
}

function mergeLoads(
  local: GymData,
  remote: GymData,
  seed: GymData,
  tombstones: Tombstone[],
  ack: Record<string, string>,
  preferLocal: boolean,
) {
  const dropped = droppedIds(tombstones, "workingLoads");
  const keys = new Set([
    ...Object.keys(local.workingLoads ?? {}),
    ...Object.keys(remote.workingLoads ?? {}),
  ]);
  const out: GymData["workingLoads"] = {};
  for (const key of keys) {
    if (dropped.has(key)) continue;
    const chosen = chooseRow(
      local.workingLoads?.[key],
      remote.workingLoads?.[key],
      seed.workingLoads?.[key],
      ack[`workingLoads:${key}`],
      () => "",
      preferLocal,
    );
    if (chosen) out[key] = chosen;
  }
  return out;
}

const MEAL_ITEM_ID = /^[A-Za-z0-9_-]{1,80}$/;

function mealItemIds(day: FoodDay): string[] {
  const meals = normalizeMealLog(day.meals);
  const ids: string[] = [];
  for (const slot of MEAL_SLOTS) {
    for (const item of meals[slot.id].items) {
      if (item.id) ids.push(item.id);
    }
  }
  return ids;
}

/** Item ids removed from a day that still exists. A deleted day uses the foodDays tombstone. */
export function clearedMealItemTombstones(prev: GymData, next: GymData): Tombstone[] {
  const surviving = new Map<string, Set<string>>();
  for (const day of next.foodDays ?? []) {
    const key = `${day.userId}|${day.date}`;
    const ids = surviving.get(key) ?? new Set<string>();
    for (const id of mealItemIds(day)) ids.add(id);
    surviving.set(key, ids);
  }
  const out: Tombstone[] = [];
  const seen = new Set<string>();
  for (const day of prev.foodDays ?? []) {
    const kept = surviving.get(`${day.userId}|${day.date}`);
    if (!kept) continue;
    for (const id of mealItemIds(day)) {
      if (kept.has(id) || seen.has(id) || !MEAL_ITEM_ID.test(id)) continue;
      seen.add(id);
      out.push({ entity: "mealItems", id });
    }
  }
  return out;
}

export function stripMealItems(days: FoodDay[], tombstones: Tombstone[]): FoodDay[] {
  const dropped = droppedIds(tombstones, "mealItems");
  if (dropped.size === 0) return days;
  return days.map((day) => {
    const meals = normalizeMealLog(day.meals);
    let changed = false;
    for (const slot of MEAL_SLOTS) {
      const items = meals[slot.id].items.filter((item) => !dropped.has(item.id));
      if (items.length !== meals[slot.id].items.length) {
        meals[slot.id] = { ...meals[slot.id], items };
        changed = true;
      }
    }
    return changed ? { ...day, meals } : day;
  });
}

export function collectTombstones(prev: GymData, next: GymData): Tombstone[] {
  const out: Tombstone[] = [];
  for (const entity of LIST_ENTITIES) {
    if (entity === "foodDays") {
      const nextDays = next.foodDays ?? [];
      const nextIds = new Set(nextDays.map((row) => row.id));
      for (const row of prev.foodDays ?? []) {
        if (nextIds.has(row.id)) continue;
        const absorbed = nextDays.some((other) => other.userId === row.userId && other.date === row.date);
        if (absorbed) continue;
        out.push({ entity: "foodDays", id: row.id });
      }
      continue;
    }
    const nextIds = new Set(next[entity].map((row) => row.id));
    for (const row of prev[entity]) {
      if (!nextIds.has(row.id)) out.push({ entity, id: row.id });
    }
  }
  for (const key of Object.keys(prev.workingLoads ?? {})) {
    if (!next.workingLoads?.[key]) out.push({ entity: "workingLoads", id: key });
  }
  const nextMembers = new Set(next.members.map((row) => `${row.duoId}:${row.userId}`));
  for (const row of prev.members) {
    const id = `${row.duoId}:${row.userId}`;
    if (!nextMembers.has(id)) out.push({ entity: "members", id });
  }
  out.push(...clearedMealItemTombstones(prev, next));
  return out.filter((row) => isTombstoneEntity(row.entity));
}

export function ackMap(data: GymData): Record<string, string> {
  const out: Record<string, string> = {};
  out.duo = stableStringify(data.duo);
  out.reminders = stableStringify(normalizeReminders(data.reminders));
  for (const row of data.users) out[`users:${row.id}`] = stableStringify(row);
  for (const row of data.members) out[`members:${row.duoId}:${row.userId}`] = stableStringify(row);
  for (const entity of LIST_ENTITIES) {
    for (const row of data[entity]) out[`${entity}:${row.id}`] = stableStringify(row);
  }
  for (const [key, value] of Object.entries(data.workingLoads ?? {})) {
    out[`workingLoads:${key}`] = stableStringify(value);
  }
  return out;
}

/** Phone-only edit clocks must not look like a different row from the server. */
function withoutLocalTargetEdits(data: GymData): GymData {
  return {
    ...data,
    users: data.users.map((row) => {
      const next = { ...row };
      delete next.proteinTargetUpdatedAt;
      delete next.kcalTargetUpdatedAt;
      delete next.profileEditedAt;
      return next;
    }),
  };
}

export function snapshotsMatch(left: GymData, right: GymData, ignoreReminders = false): boolean {
  return sameSnapshot(
    canonicalize(withoutLocalTargetEdits(left)),
    canonicalize(withoutLocalTargetEdits(right)),
    { ignoreReminders },
  );
}
