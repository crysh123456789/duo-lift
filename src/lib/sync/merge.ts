import { createSeed } from "@/lib/seed";
import type { FoodDay, GymData, ReminderSettings } from "@/lib/types";
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
    workouts: mergeList(
      "workouts",
      local.workouts,
      remote.workouts,
      seed.workouts,
      tombstones,
      ack,
      preferLocal,
      (row) => row.endedAt ?? row.startedAt,
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
    foodDays: mergeList(
      "foodDays",
      collapseFoodDays(local.foodDays ?? []),
      collapseFoodDays(remote.foodDays ?? []),
      seed.foodDays ?? [],
      tombstones,
      ack,
      preferLocal,
      (row) => row.updatedAt,
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
  const foodDays = (local.foodDays ?? []).filter((row) => !drop("foodDays").has(row.id));
  const loadDrop = drop("workingLoads");
  const workingLoads = Object.fromEntries(
    Object.entries(local.workingLoads ?? {}).filter(([key]) => !loadDrop.has(key)),
  );
  const memberDrop = drop("members");
  const members = local.members.filter((row) => !memberDrop.has(`${row.duoId}:${row.userId}`));
  return { ...local, workouts, blocks, stations, sets, reactions, exercises, foodDays, workingLoads, members };
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
    const chosen = chooseRow(
      localById.get(id),
      remoteById.get(id),
      seedById.get(id),
      ack[`users:${id}`],
      (row) => row.createdAt,
      preferLocal,
    );
    if (chosen) out.push(chosen);
  }
  return out;
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

function collapseFoodDays(rows: FoodDay[]): FoodDay[] {
  const byDay = new Map<string, FoodDay>();
  for (const row of rows) {
    const key = `${row.userId}|${row.date}`;
    const prev = byDay.get(key);
    if (!prev || row.updatedAt >= prev.updatedAt) byDay.set(key, row);
  }
  return [...byDay.values()];
}

export function collectTombstones(prev: GymData, next: GymData): Tombstone[] {
  const out: Tombstone[] = [];
  for (const entity of LIST_ENTITIES) {
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

export function snapshotsMatch(left: GymData, right: GymData, ignoreReminders = false): boolean {
  return sameSnapshot(canonicalize(left), canonicalize(right), { ignoreReminders });
}
