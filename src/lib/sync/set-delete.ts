import { isLegacySeedId } from "@/lib/seed";
import { SET_DELETE_ENABLED } from "@/lib/sets/edit";
import { SYNC_ID } from "@/lib/sync/payload";
import { addTombstones } from "@/lib/sync/storage";
import type { Tombstone } from "@/lib/sync/types";

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
