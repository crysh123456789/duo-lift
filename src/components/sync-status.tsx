"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { retryGymSync } from "@/lib/sync/engine";
import {
  SYNC_ERROR_LABEL,
  SYNC_ERROR_LABEL_SHORT,
  getSyncPhase,
  subscribeSyncPhase,
  syncPhaseLabel,
} from "@/lib/sync/status";

const PILL = "min-w-0 font-mono text-xs leading-tight tracking-wide text-muted";

function useCompactError(active: boolean) {
  const ref = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    if (!active) return;
    const probe = document.createElement("span");
    probe.className = "font-mono text-xs tracking-wide";
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;pointer-events:none";
    probe.textContent = SYNC_ERROR_LABEL;
    document.body.appendChild(probe);
    const needed = probe.offsetWidth;
    probe.remove();

    const measure = () => {
      const node = ref.current;
      const row = node?.closest("[data-sync-row]");
      if (!node || !(row instanceof HTMLElement)) return;
      const cluster = node.parentElement;
      let used = 0;
      if (cluster) {
        for (const child of cluster.children) {
          if (child === node) continue;
          used += (child as HTMLElement).offsetWidth;
        }
      }
      let right = 0;
      for (const child of row.children) {
        if (child === cluster || child.contains(node)) continue;
        right += (child as HTMLElement).offsetWidth;
      }
      const rowGap = parseFloat(getComputedStyle(row).columnGap || "0") || 0;
      const clusterGap = cluster ? parseFloat(getComputedStyle(cluster).columnGap || "0") || 0 : 0;
      const available = row.clientWidth - used - right - rowGap - clusterGap - 8;
      if (available <= 0) return;
      setCompact(needed > available);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    const row = ref.current?.closest("[data-sync-row]");
    if (row instanceof HTMLElement) observer.observe(row);
    return () => observer.disconnect();
  }, [active]);

  return { ref, compact };
}

/**
 * Sync pill. `data-sync-phase` is local | offline | syncing | saved | error.
 * Error and offline copy says the phone log is still there.
 */
export function SyncStatus() {
  const phase = useSyncExternalStore(subscribeSyncPhase, getSyncPhase, () => "local" as const);
  const { ref, compact } = useCompactError(phase === "error");
  const label = phase === "error" && compact ? SYNC_ERROR_LABEL_SHORT : syncPhaseLabel(phase);

  if (phase === "saved") return null;

  if (phase === "error") {
    return (
      <button
        ref={ref as RefObject<HTMLButtonElement | null>}
        type="button"
        data-sync-phase={phase}
        aria-live="polite"
        className={`${PILL} text-left text-foreground`}
        onClick={() => retryGymSync()}
      >
        {label}
      </button>
    );
  }

  return (
    <span ref={ref} data-sync-phase={phase} aria-live="polite" className={PILL}>
      {label}
    </span>
  );
}
