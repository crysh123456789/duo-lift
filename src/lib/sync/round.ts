import { collapseFoodDays } from "@/lib/nutrition";
import { isDemoTombstone, omitSeedHistory } from "@/lib/seed";
import { SET_DELETE_ENABLED } from "@/lib/sets/edit";
import type { GymData } from "@/lib/types";
import { mergeRemoteSnapshot, stripMealItems } from "./merge";
import { canonicalize } from "./snapshot";
import type { Tombstone } from "./types";

/**
 * Set deletes stay in the phone queue until 0015/0016 and the tolerant sync.
 * Sending one makes sync_apply call soft_delete_own_set and the round gets 42501.
 */
function tombstonesSafeToSend(rows: Tombstone[]): Tombstone[] {
  if (SET_DELETE_ENABLED) return rows;
  return rows.filter((row) => row.entity !== "sets");
}

const HISTORY = ["workouts", "blocks", "stations", "sets", "foodDays"] as const;

function forwardsTombstone(localData: GymData, row: Tombstone, ack: Record<string, string>): boolean {
  if (isDemoTombstone(row, localData)) return false;
  if (!(HISTORY as readonly string[]).includes(row.entity)) return true;
  const rows = localData[row.entity as (typeof HISTORY)[number]];
  const exists = rows.some((item) => item.id === row.id);
  if (!exists) return true;
  return Boolean(ack[`${row.entity}:${row.id}`]);
}

export function dedupeTombstones(rows: Tombstone[]): Tombstone[] {
  const map = new Map<string, Tombstone>();
  for (const row of rows) map.set(`${row.entity}:${row.id}`, row);
  return [...map.values()];
}

/**
 * Remote deletes are not applied on the first upload. A tombstone cannot drop
 * a history row this phone still has unless that row was acknowledged before
 * (the other phone deleted a shared row).
 */
export function tombstonesForRound(
  migrated: boolean,
  localData: GymData,
  localStones: Tombstone[],
  remoteStones: Tombstone[],
  ack: Record<string, string>,
): Tombstone[] {
  const combined = dedupeTombstones(migrated ? [...remoteStones, ...localStones] : localStones);
  return tombstonesSafeToSend(combined.filter((row) => forwardsTombstone(localData, row, ack)));
}

function setSlot(row: { stationId: string; roundIndex: number; setIndex: number }) {
  return `${row.stationId}\n${row.roundIndex}\n${row.setIndex}`;
}

/** True when every local history row is still present, or this phone deleted it. */
export function historyPreserved(before: GymData, after: GymData, tombstones: Tombstone[]): boolean {
  for (const entity of HISTORY) {
    const dropped = new Set(tombstones.filter((row) => row.entity === entity).map((row) => row.id));
    const afterIds = new Set((after[entity] ?? []).map((row) => row.id));
    for (const row of before[entity] ?? []) {
      if (dropped.has(row.id) || afterIds.has(row.id)) continue;
      if (entity === "foodDays") {
        const day = row as GymData["foodDays"][number];
        const absorbed = (after.foodDays ?? []).some(
          (other) => other.userId === day.userId && other.date === day.date,
        );
        if (absorbed) continue;
      }
      if (entity === "sets") {
        const set = row as GymData["sets"][number];
        const slot = setSlot(set);
        const kept = (after.sets ?? []).some((other) => other.id !== set.id && setSlot(other) === slot);
        if (kept) continue;
      }
      return false;
    }
  }
  return true;
}

/**
 * The upload keeps one live row per slot. The older copy stays on the phone
 * while set deletes are off, so applying the snapshot does not drop it.
 */
export function retainUnsentDuplicateSets(local: GymData, snapshot: GymData): GymData {
  if (SET_DELETE_ENABLED) return snapshot;
  const keptSlots = new Set(snapshot.sets.map(setSlot));
  const sent = new Set(snapshot.sets.map((row) => row.id));
  const extras = local.sets.filter((row) => !sent.has(row.id) && keptSlots.has(setSlot(row)));
  if (extras.length === 0) return snapshot;
  return canonicalize({ ...snapshot, sets: [...snapshot.sets, ...extras] });
}

export function missingWorkoutIds(sent: GymData, returned: GymData | null, tombstones: Tombstone[]): string[] {
  const dropped = new Set(tombstones.filter((row) => row.entity === "workouts").map((row) => row.id));
  const got = new Set(returned?.workouts.map((row) => row.id) ?? []);
  return sent.workouts
    .filter((row) => row.duoId === sent.duo.id && !dropped.has(row.id) && !got.has(row.id))
    .map((row) => row.id);
}

export function serverKeptWorkouts(sent: GymData, returned: GymData | null, tombstones: Tombstone[]): boolean {
  if (!returned) return false;
  return missingWorkoutIds(sent, returned, tombstones).length === 0;
}

/** One row per station/round/set slot so `set_logs` unique index does not reject the upload. */
export function collapseDuplicateSets(data: GymData): { data: GymData; tombstones: Tombstone[] } {
  const bySlot = new Map<string, GymData["sets"]>();
  for (const row of data.sets) {
    const key = `${row.stationId}\n${row.roundIndex}\n${row.setIndex}`;
    const list = bySlot.get(key) ?? [];
    list.push(row);
    bySlot.set(key, list);
  }
  const sets: GymData["sets"] = [];
  const tombstones: Tombstone[] = [];
  for (const list of bySlot.values()) {
    const ranked = [...list].sort((a, b) => {
      if (a.loggedAt !== b.loggedAt) return a.loggedAt < b.loggedAt ? 1 : -1;
      return a.id.localeCompare(b.id);
    });
    const keep = ranked[0];
    if (keep) sets.push(keep);
    if (!SET_DELETE_ENABLED) continue;
    for (const extra of ranked.slice(1)) tombstones.push({ entity: "sets", id: extra.id });
  }
  return { data: { ...data, sets }, tombstones };
}

/** One live row per person and date. The absorbed id is not a tombstone. */
export function collapseDuplicateFoodDays(data: GymData): { data: GymData; tombstones: Tombstone[] } {
  return { data: { ...data, foodDays: collapseFoodDays(data.foodDays ?? []) }, tombstones: [] };
}

type PrepareOptions = {
  ack?: Record<string, string>;
  remindersFromServer?: boolean;
  preferLocal?: boolean;
};

/**
 * Snapshot to send. Does not touch the store. `preferLocal` keeps phone rows
 * until the server has acknowledged an upload from this device.
 */
export function prepareSyncSnapshot(
  local: GymData,
  remote: GymData | null,
  tombstones: Tombstone[],
  options?: PrepareOptions,
): { snapshot: GymData; tombstones: Tombstone[]; keepsHistory: boolean } {
  const ack = options?.ack ?? {};
  const safeTombstones = tombstonesSafeToSend(tombstones.filter((row) => forwardsTombstone(local, row, ack)));
  const merged = mergeRemoteSnapshot(local, remote, safeTombstones, options);
  const collapsedSets = collapseDuplicateSets(merged);
  const collapsed = collapseDuplicateFoodDays(collapsedSets.data);
  const nextTombstones = tombstonesSafeToSend(
    dedupeTombstones([
      ...safeTombstones,
      ...collapsedSets.tombstones,
      ...collapsed.tombstones,
    ]).filter((row) => !isDemoTombstone(row, local)),
  );
  const snapshot = canonicalize(
    omitSeedHistory({
      ...collapsed.data,
      foodDays: stripMealItems(collapsed.data.foodDays ?? [], nextTombstones),
    }),
  );
  return {
    snapshot,
    tombstones: nextTombstones,
    keepsHistory: historyPreserved(omitSeedHistory(local), snapshot, nextTombstones),
  };
}
