export type SyncPhase = "local" | "offline" | "syncing" | "saved" | "error";

/** Shown when the long error line does not fit in the header. */
export const SYNC_ERROR_LABEL = "No se pudo subir · datos seguros en el teléfono";
export const SYNC_ERROR_LABEL_SHORT = "Error · reintentar";
/** Shown after a successful round that refused another account's food-day ids. */
export const FOOD_DAY_REJECTED_LABEL = "Días de otra cuenta no se subieron · siguen en el teléfono";

/**
 * Header pill. Local history is never described as lost or cleared.
 * `local`     sync is off
 * `offline`   no network; the phone log is still the log
 * `syncing`   a pull/push is in flight
 * `saved`     the server acknowledged this phone's history
 * `error`     the last attempt failed; the phone log was kept
 */
let phase: SyncPhase = "local";
let foodDayRejection = false;
/** True after the first sync round of this page load settles, success or not. */
let serverHydrated = false;
const listeners = new Set<() => void>();

export function getSyncPhase(): SyncPhase {
  return phase;
}

export function setSyncPhase(next: SyncPhase) {
  if (phase === next) return;
  phase = next;
  for (const listener of listeners) listener();
}

export function getFoodDayRejection(): boolean {
  return foodDayRejection;
}

export function setFoodDayRejection(active: boolean) {
  if (foodDayRejection === active) return;
  foodDayRejection = active;
  for (const listener of listeners) listener();
}

export function isServerHydrated(): boolean {
  return serverHydrated;
}

/** The phone may show training counts and open sessions. Later rounds do not hide them again. */
export function markServerHydrated() {
  if (serverHydrated) return;
  serverHydrated = true;
  for (const listener of listeners) listener();
}

export function subscribeSyncPhase(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function syncPhaseLabel(phase: SyncPhase): string {
  switch (phase) {
    case "offline":
      return "Sin red · datos en el teléfono";
    case "syncing":
      return "Subiendo tu historial…";
    case "saved":
      return "Guardado en la nube";
    case "error":
      return SYNC_ERROR_LABEL;
    default:
      return "Local";
  }
}
