import { isDemoTombstone } from "@/lib/seed";
import type { Tombstone } from "./types";

const TOMBSTONE_KEY = "duo-lift-sync-tombstones";
const ACK_KEY = "duo-lift-sync-ack";
const META_KEY = "duo-lift-sync-meta";

/** Queues are per auth user so one phone can hold two accounts without mixing deletes. */
let storageUser = "";

export function setSyncStorageUser(userId: string | null) {
  storageUser = userId ?? "";
}

function scoped(base: string) {
  return storageUser ? `${base}:${storageUser}` : base;
}

export type SyncMeta = {
  /** Set after the first successful upload of this browser's localStorage. */
  migratedAt: string | null;
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(scoped(key));
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(scoped(key), JSON.stringify(value));
}

/** One-time copy of the shared queue, limited to ids this account still owns. */
export function seedLegacyTombstones(userId: string, ownedIds: ReadonlySet<string>) {
  if (typeof localStorage === "undefined" || !userId) return;
  const flag = `duo-lift-sync-seeded:${userId}`;
  if (localStorage.getItem(flag)) return;
  localStorage.setItem(flag, "1");
  let legacy: Tombstone[] = [];
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Tombstone[]) : [];
    legacy = Array.isArray(parsed) ? parsed : [];
  } catch {
    legacy = [];
  }
  const mine = legacy.filter(
    (row) => ownedIds.has(row.id) && row.entity !== "foodDays" && !isDemoTombstone(row),
  );
  if (mine.length > 0) addTombstones(mine);
}

function tombstoneKey(row: Tombstone) {
  return `${row.entity}:${row.id}`;
}

export function readTombstones(): Tombstone[] {
  const rows = readJson<Tombstone[]>(TOMBSTONE_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function addTombstones(rows: Tombstone[]) {
  if (rows.length === 0) return;
  const map = new Map(readTombstones().map((row) => [tombstoneKey(row), row]));
  for (const row of rows) map.set(tombstoneKey(row), row);
  writeJson(TOMBSTONE_KEY, [...map.values()]);
}

export function removeTombstones(rows: Tombstone[]) {
  if (rows.length === 0) return;
  const drop = new Set(rows.map(tombstoneKey));
  writeJson(
    TOMBSTONE_KEY,
    readTombstones().filter((row) => !drop.has(tombstoneKey(row))),
  );
}

export function readAck(): Record<string, string> {
  const value = readJson<Record<string, string>>(ACK_KEY, {});
  return value && typeof value === "object" ? value : {};
}

export function writeAck(ack: Record<string, string>) {
  writeJson(ACK_KEY, ack);
}

export function readSyncMeta(): SyncMeta {
  const value = readJson<SyncMeta>(META_KEY, { migratedAt: null });
  return { migratedAt: value?.migratedAt ?? null };
}

export function writeSyncMeta(meta: SyncMeta) {
  writeJson(META_KEY, meta);
}
