import type { GymData } from "@/lib/types";
import { isTombstoneEntity, type Tombstone, type TombstoneEntity } from "./types";

/** Rows the server refused. The phone drops them so the next round does not send them again. */
export const SYNC_ITEM_STATUSES = ["obsolete", "rejected"] as const;

export type SyncItemStatus = (typeof SYNC_ITEM_STATUSES)[number];

export type SyncItemResult = {
  entity: TombstoneEntity;
  id: string;
  status: SyncItemStatus;
};

const DROPPED: readonly TombstoneEntity[] = [
  "workouts",
  "blocks",
  "stations",
  "sets",
  "reactions",
  "exercises",
  "workingLoads",
];

function itemRows(source: unknown): unknown[] {
  if (!source || typeof source !== "object") return [];
  const body = source as { items?: unknown; rejected?: unknown };
  if (Array.isArray(body.items)) return body.items;
  if (body.rejected && typeof body.rejected === "object") {
    const nested = (body.rejected as { items?: unknown }).items;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

/** Obsolete and rejected rows from sync_apply, or from the /api/sync body. */
export function syncItemResults(source: unknown): SyncItemResult[] {
  const out: SyncItemResult[] = [];
  const seen = new Set<string>();
  for (const row of itemRows(source)) {
    if (!row || typeof row !== "object") continue;
    const entity = (row as { entity?: unknown }).entity;
    const id = (row as { id?: unknown }).id;
    const status = (row as { status?: unknown }).status;
    if (typeof entity !== "string" || !isTombstoneEntity(entity)) continue;
    if (typeof id !== "string" || id.length === 0) continue;
    if (status !== "obsolete" && status !== "rejected") continue;
    const key = `${entity}:${id}:${status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ entity, id, status });
  }
  return out;
}

function idsFor(items: SyncItemResult[], entity: TombstoneEntity): Set<string> {
  return new Set(items.filter((row) => row.entity === entity).map((row) => row.id));
}

/** Removes rows the server will not store. Food days stay; that rejection already has its own warning. */
export function omitSyncItems(data: GymData, items: SyncItemResult[]): GymData {
  const drop = (entity: TombstoneEntity) => idsFor(items, entity);
  const workouts = data.workouts.filter((row) => !drop("workouts").has(row.id));
  const blocks = data.blocks.filter((row) => !drop("blocks").has(row.id));
  const stations = data.stations.filter((row) => !drop("stations").has(row.id));
  const sets = data.sets.filter((row) => !drop("sets").has(row.id));
  const reactions = data.reactions.filter((row) => !drop("reactions").has(row.id));
  const exercises = data.exercises.filter((row) => !drop("exercises").has(row.id));
  const loadDrop = drop("workingLoads");
  const workingLoads = Object.fromEntries(
    Object.entries(data.workingLoads ?? {}).filter(([key]) => !loadDrop.has(key)),
  );
  return { ...data, workouts, blocks, stations, sets, reactions, exercises, workingLoads };
}

/**
 * Drop rejected and obsolete rows. Obsolete ones are also queued as tombstones
 * so a later merge cannot put the deleted row back.
 */
export function applySyncItemResults(
  data: GymData,
  results: SyncItemResult[],
): { data: GymData; tombstones: Tombstone[] } {
  const dropped = results.filter(
    (row) => DROPPED.includes(row.entity) && (row.status === "obsolete" || row.status === "rejected"),
  );
  const seen = new Set<string>();
  const tombstones: Tombstone[] = [];
  for (const row of dropped) {
    if (row.status !== "obsolete") continue;
    const key = `${row.entity}:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tombstones.push({ entity: row.entity, id: row.id });
  }
  return { data: omitSyncItems(data, dropped), tombstones };
}
