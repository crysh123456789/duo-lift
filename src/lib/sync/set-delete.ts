import { isLegacySeedId } from "@/lib/seed";
import { SET_DELETE_ENABLED } from "@/lib/sets/edit";
import type { SyncItemResult } from "@/lib/sync/items";
import { SYNC_ID } from "@/lib/sync/payload";
import { addTombstones } from "@/lib/sync/storage";
import type { Tombstone } from "@/lib/sync/types";
import type { GymData } from "@/lib/types";

/**
 * A removed series must be named before the next sync compares baselines.
 * Without this, a later pull puts the server row back.
 * Demo ids are ignored: the server refuses those tombstones.
 */
export function setDeletionTombstone(setId: string): Tombstone | null {
  if (!setId || isLegacySeedId(setId) || !SYNC_ID.test(setId)) return null;
  return { entity: "sets", id: setId };
}

export function queueSetDeletion(setId: string) {
  if (!SET_DELETE_ENABLED) return;
  const stone = setDeletionTombstone(setId);
  if (!stone) return;
  addTombstones([stone]);
}

export type SetDeleteSettlement = {
  /** Accepted, obsolete, or already gone. Leave the phone queue. */
  drain: Tombstone[];
  /** soft_delete_own_set returned false and the series is still live on the server. */
  keepQueued: Tombstone[];
  /** The server rejected these series as someone else's. They stay on the phone. */
  keepSetIds: string[];
  /** Show the sync error. This reply must not delete any other phone row. */
  error: boolean;
};

/**
 * A set tombstone the server accepted is drained.
 * `obsolete` is the same: the row is already gone, so it is not revived and nothing else is deleted.
 * `rejected` keeps that series. `false` (the row is still live and no tombstone was recorded)
 * stays in the queue and surfaces as an error, without dropping other series.
 * `false` when the caller's snapshot no longer has the row is resolved: drain it, delete nothing else.
 */
export function settleSetDeletes(input: {
  sent: Tombstone[];
  serverTombstones: Tombstone[];
  items: SyncItemResult[];
  serverSetIds: ReadonlySet<string>;
}): SetDeleteSettlement {
  const drain: Tombstone[] = [];
  const keepQueued: Tombstone[] = [];
  const keepSetIds: string[] = [];
  let error = false;
  const seenKeep = new Set<string>();

  for (const row of input.items) {
    if (row.entity !== "sets" || row.status !== "rejected") continue;
    if (seenKeep.has(row.id)) continue;
    seenKeep.add(row.id);
    keepSetIds.push(row.id);
    error = true;
  }

  const serverDeleted = new Set(
    input.serverTombstones.filter((row) => row.entity === "sets").map((row) => row.id),
  );
  const itemStatus = new Map<string, SyncItemResult["status"]>();
  for (const row of input.items) {
    if (row.entity === "sets") itemStatus.set(row.id, row.status);
  }

  for (const row of input.sent) {
    if (row.entity !== "sets") {
      drain.push(row);
      continue;
    }
    const status = itemStatus.get(row.id);
    if (status === "rejected") {
      drain.push(row);
      continue;
    }
    if (status === "obsolete" || serverDeleted.has(row.id)) {
      drain.push(row);
      continue;
    }
    if (input.serverSetIds.has(row.id)) {
      keepQueued.push(row);
      error = true;
      continue;
    }
    drain.push(row);
  }

  return { drain, keepQueued, keepSetIds, error };
}

/** Puts a rejected series back when the server still has it. Never removes a row. */
export function restoreRejectedSets(
  local: GymData,
  returned: GymData | null,
  keepSetIds: readonly string[],
): GymData {
  if (!returned || keepSetIds.length === 0) return local;
  const keep = new Set(keepSetIds);
  const have = new Set(local.sets.map((row) => row.id));
  const extra = returned.sets.filter((row) => keep.has(row.id) && !have.has(row.id));
  if (extra.length === 0) return local;
  return { ...local, sets: [...local.sets, ...extra] };
}
