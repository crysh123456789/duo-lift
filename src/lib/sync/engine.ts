"use client";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { useGymStore } from "@/lib/store";
import type { GymData } from "@/lib/types";
import { ackMap, collectTombstones, mergeRemoteSnapshot, snapshotsMatch } from "./merge";
import { parseSnapshot, parseTombstones } from "./payload";
import { snapshotFromState } from "./snapshot";
import { setSyncPhase } from "./status";
import {
  addTombstones,
  readAck,
  readSyncMeta,
  readTombstones,
  removeTombstones,
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

function currentSnapshot(): GymData {
  return snapshotFromState(useGymStore.getState());
}

function applySnapshot(next: GymData) {
  applying = true;
  useGymStore.setState(next);
  applying = false;
}

async function pull(duoId: string, signal: AbortSignal): Promise<SyncResponse> {
  const response = await fetch(`/api/sync?duoId=${encodeURIComponent(duoId)}`, {
    cache: "no-store",
    signal,
  });
  const body = (await response.json().catch(() => ({}))) as SyncResponse;
  if (response.status === 401) {
    const error = new Error("unauthorized");
    error.name = "Unauthorized";
    throw error;
  }
  if (!response.ok) throw new Error(body.error || "sync_failed");
  return body;
}

async function push(data: GymData, tombstones: Tombstone[], signal: AbortSignal) {
  const response = await fetch("/api/sync", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ snapshot: data, tombstones }),
    signal,
  });
  const body = (await response.json().catch(() => ({}))) as SyncResponse;
  if (!response.ok || body.ok === false) throw new Error(body.error || "sync_failed");
  return body;
}

/**
 * Local Zustand persist stays the cache. When sync is enabled and the browser
 * is online, pull remote rows, union them with local (tombstones win), then
 * push the result. The first successful push migrates existing localStorage.
 */
export function startGymSync() {
  stopCurrent?.();
  const controller = new AbortController();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let queued = false;
  let baseline = currentSnapshot();

  // Construct the anon client so the browser wiring stays live. It cannot write:
  // anon table grants are revoked until Seguridad reviews RLS.
  createBrowserSupabaseClient();

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
      setSyncPhase("syncing");
      const local = currentSnapshot();
      const remoteBody = await pull(local.duo.id, controller.signal);
      if (stopped) return;
      if (!remoteBody.enabled) {
        setSyncPhase("local");
        return;
      }
      const remote = remoteBody.data ? parseSnapshot(remoteBody.data) : null;
      const remoteTombstones = parseTombstones(remoteBody.tombstones);
      const remindersFromServer = remoteBody.remindersFromServer !== false && remote != null;
      const merged = mergeRemoteSnapshot(local, remote, [...remoteTombstones, ...readTombstones()], {
        ack: readAck(),
        remindersFromServer,
      });
      if (!snapshotsMatch(merged, currentSnapshot(), !remindersFromServer)) {
        applySnapshot(merged);
        baseline = currentSnapshot();
      }
      const after = currentSnapshot();
      const stones = readTombstones();
      const ignoreReminders = !remindersFromServer;
      const needsPush =
        remote == null ||
        stones.length > 0 ||
        !snapshotsMatch(after, remote ?? after, ignoreReminders);
      if (needsPush) {
        await push(after, stones, controller.signal);
        if (stopped) return;
        removeTombstones(stones);
        const meta = readSyncMeta();
        if (!meta.migratedAt) writeSyncMeta({ migratedAt: new Date().toISOString() });
      }
      writeAck(ackMap(currentSnapshot()));
      baseline = currentSnapshot();
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
      setSyncPhase("error");
    } finally {
      running = false;
      if (queued && !stopped) {
        queued = false;
        schedule();
      }
    }
  };

  const onStore = () => {
    if (applying) {
      baseline = currentSnapshot();
      return;
    }
    const next = currentSnapshot();
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
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  void cycle();

  const stop = () => {
    stopped = true;
    controller.abort();
    if (timer) clearTimeout(timer);
    unsub();
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
    if (stopCurrent === stop) stopCurrent = null;
  };
  stopCurrent = stop;
  return stop;
}
