export type SyncPhase = "local" | "offline" | "syncing" | "saved" | "error";

/**
 * UX hook. The pill is intentionally plain so it can be restyled later.
 * `local`     sync is off; the pill says "Local"
 * `offline`   no network; the Zustand cache is still the log ("Sin red")
 * `syncing`   a pull/push is in flight ("Sync…")
 * `saved`     the last round trip matched Supabase ("Guardado")
 * `error`     the last attempt failed; local data was kept ("Reintento")
 */
let phase: SyncPhase = "local";
const listeners = new Set<() => void>();

export function getSyncPhase(): SyncPhase {
  return phase;
}

export function setSyncPhase(next: SyncPhase) {
  if (phase === next) return;
  phase = next;
  for (const listener of listeners) listener();
}

export function subscribeSyncPhase(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function syncPhaseLabel(phase: SyncPhase): string {
  switch (phase) {
    case "offline":
      return "Sin red";
    case "syncing":
      return "Sync…";
    case "saved":
      return "Guardado";
    case "error":
      return "Reintento";
    default:
      return "Local";
  }
}
