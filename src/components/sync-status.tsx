"use client";

import { useSyncExternalStore } from "react";
import { getSyncPhase, subscribeSyncPhase, syncPhaseLabel } from "@/lib/sync/status";

/**
 * Sync pill for the header.
 * UX can restyle this later. The contract is `data-sync-phase`:
 * local | offline | syncing | saved | error.
 * Copy stays short on purpose. Local data is never cleared when the phase is error or offline.
 */
export function SyncStatus() {
  const phase = useSyncExternalStore(subscribeSyncPhase, getSyncPhase, () => "local" as const);
  return (
    <span
      data-sync-phase={phase}
      className="shrink-0 font-mono text-[10px] tracking-wide text-muted uppercase"
    >
      {syncPhaseLabel(phase)}
    </span>
  );
}
