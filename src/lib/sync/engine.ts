"use client";

import { scopeToUser, stitchGym } from "@/lib/auth/scope";
import { useGymStore } from "@/lib/store";
import type { GymData } from "@/lib/types";
import { ackMap, collectTombstones, snapshotsMatch } from "./merge";
import { parseSnapshot, parseTombstones } from "./payload";
import { prepareSyncSnapshot, serverKeptWorkouts, tombstonesForRound } from "./round";
import { getSyncUserId, subscribeSyncUser } from "./session-user";
import { snapshotFromState } from "./snapshot";
import { setSyncPhase } from "./status";
import {
  addTombstones,
  readAck,
  readSyncMeta,
  readTombstones,
  removeTombstones,
  seedLegacyTombstones,
  setSyncStorageUser,
  writeAck,
  writeSyncMeta,
} from "./storage";
import type { Tombstone } from "./types";

type SyncResponse = {
  ok?: boolean;
  enabled?: boolean;
  remindersFromServer?: boolean;
  data?: unknown;
  tombstones?: unknown;
  error?: string;
};

let applying = false;
let stopCurrent: (() => void) | null = null;
let requestCycle: (() => void) | null = null;

function currentSnapshot(): GymData {
  return snapshotFromState(useGymStore.getState());
}

function ownSnapshot(userId: string): GymData {
  return scopeToUser(currentSnapshot(), userId);
}

function applyOwn(own: GymData, userId: string) {
  applying = true;
  try {
    useGymStore.setState(stitchGym(currentSnapshot(), own, userId));
  } finally {
    applying = false;
  }
}

function logSync(message: string) {
  console.warn(`[sync] ${message}`);
}

async function pull(signal: AbortSignal): Promise<SyncResponse> {
  const response = await fetch("/api/sync", {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  const body = (await response.json().catch(() => ({}))) as SyncResponse;
  if (response.status === 401) {
    const error = new Error("unauthorized");
    error.name = "Unauthorized";
    throw error;
  }
  if (!response.ok || body.ok === false) throw new Error(body.error || "sync_failed");
  return body;
}

async function push(data: GymData, tombstones: Tombstone[], signal: AbortSignal): Promise<SyncResponse> {
  const response = await fetch("/api/sync", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ snapshot: data, tombstones }),
    signal,
  });
  const body = (await response.json().catch(() => ({}))) as SyncResponse;
  if (!response.ok || body.ok === false) throw new Error(body.error || "sync_failed");
  return body;
}

/** Runs another round now. Used by the error pill. No-op until sync has started. */
export function retryGymSync() {
  requestCycle?.();
}

/**
 * Local Zustand persist stays the cache. The store is not replaced with the
 * server copy until that upload has been acknowledged. A failed round leaves
 * the phone history where it is.
 */
export function startGymSync() {
  stopCurrent?.();
  const controller = new AbortController();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let queued = false;
  let baseline = currentSnapshot();

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void cycle();
    }, 1000);
  };

  const cycle = async () => {
    if (stopped) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setSyncPhase("offline");
        return;
      }
      const userId = getSyncUserId();
      if (!userId) {
        setSyncPhase("local");
        return;
      }
      setSyncStorageUser(userId);
      setSyncPhase("syncing");
      const started = ownSnapshot(userId);
      const ownedIds = new Set<string>([
        ...started.workouts.map((row) => row.id),
        ...started.blocks.map((row) => row.id),
        ...started.stations.map((row) => row.id),
        ...started.sets.map((row) => row.id),
        ...started.foodDays.map((row) => row.id),
        ...Object.keys(started.workingLoads),
      ]);
      seedLegacyTombstones(userId, ownedIds);
      const remoteBody = await pull(controller.signal);
      if (stopped) return;
      if (!remoteBody.enabled) {
        setSyncPhase("local");
        return;
      }
      const parsed = remoteBody.data ? parseSnapshot(remoteBody.data) : null;
      const remote = parsed ? { ...parsed, duo: started.duo } : null;
      const remoteTombstones = parseTombstones(remoteBody.tombstones);
      const migrated = Boolean(readSyncMeta().migratedAt);
      const remindersFromServer = migrated && remoteBody.remindersFromServer !== false && remote != null;
      const ack = readAck();
      const options = {
        ack,
        remindersFromServer,
        preferLocal: !migrated,
      };
      const prepared = prepareSyncSnapshot(
        started,
        remote,
        tombstonesForRound(migrated, started, readTombstones(), remoteTombstones, ack),
        options,
      );
      if (!prepared.keepsHistory) {
        logSync("refused an upload that would drop phone history");
        setSyncPhase("error");
        return;
      }
      const ignoreReminders = !remindersFromServer;
      const remoteDeletes = new Set(remoteTombstones.map((row) => `${row.entity}:${row.id}`));
      const pendingDeletes = prepared.tombstones.filter((row) => !remoteDeletes.has(`${row.entity}:${row.id}`));
      const needsPush =
        remote == null ||
        pendingDeletes.length > 0 ||
        !snapshotsMatch(prepared.snapshot, remote, ignoreReminders);
      if (needsPush) {
        const pushed = await push(prepared.snapshot, prepared.tombstones, controller.signal);
        if (stopped) return;
        const returned = pushed.data ? parseSnapshot(pushed.data) : null;
        if (!serverKeptWorkouts(prepared.snapshot, returned, prepared.tombstones)) {
          logSync("server ack did not include the phone workouts");
          setSyncPhase("error");
          return;
        }
        removeTombstones(prepared.tombstones);
      }
      const latest = ownSnapshot(userId);
      const latestStones = tombstonesForRound(migrated, latest, readTombstones(), remoteTombstones, ack);
      const followUp = snapshotsMatch(latest, started, ignoreReminders)
        ? prepared
        : prepareSyncSnapshot(latest, remote, latestStones, options);
      if (!followUp.keepsHistory) {
        logSync("refused to replace phone history after ack");
        setSyncPhase("error");
        return;
      }
      if (!snapshotsMatch(followUp.snapshot, latest, ignoreReminders)) {
        applyOwn(followUp.snapshot, userId);
      }
      writeAck(ackMap(prepared.snapshot));
      if (!readSyncMeta().migratedAt) writeSyncMeta({ migratedAt: new Date().toISOString() });
      baseline = ownSnapshot(userId);
      setSyncPhase("saved");
    } catch (error) {
      if (stopped || (error instanceof DOMException && error.name === "AbortError")) return;
      if (error instanceof Error && error.name === "Unauthorized") {
        setSyncPhase("local");
        return;
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setSyncPhase("offline");
        return;
      }
      logSync(error instanceof Error ? error.message : "round failed");
      setSyncPhase("error");
    } finally {
      running = false;
      if (queued && !stopped) {
        queued = false;
        schedule();
      }
    }
  };

  const retry = () => {
    void cycle();
  };
  requestCycle = retry;

  const onStore = () => {
    const userId = getSyncUserId();
    if (!userId) return;
    const next = ownSnapshot(userId);
    if (applying) {
      baseline = next;
      return;
    }
    const stones = collectTombstones(baseline, next);
    baseline = next;
    if (stones.length > 0) addTombstones(stones);
    schedule();
  };

  const onOnline = () => {
    void cycle();
  };
  const onOffline = () => setSyncPhase("offline");
  const onVisible = () => {
    if (document.visibilityState === "visible") void cycle();
  };

  const unsub = useGymStore.subscribe(onStore);
  const unsubUser = subscribeSyncUser(() => {
    const userId = getSyncUserId();
    baseline = userId ? ownSnapshot(userId) : currentSnapshot();
    void cycle();
  });
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  void cycle();

  const stop = () => {
    stopped = true;
    controller.abort();
    if (timer) clearTimeout(timer);
    unsub();
    unsubUser();
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
    if (requestCycle === retry) requestCycle = null;
    if (stopCurrent === stop) stopCurrent = null;
  };
  stopCurrent = stop;
  return stop;
}
