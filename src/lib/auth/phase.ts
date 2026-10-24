/** Auth gate phase. */

export type AuthPhase = "boot" | "anon" | "in" | "error";

let phase: AuthPhase = "boot";
let epoch = 0;
let errorMessage = "";
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getAuthPhase(): AuthPhase {
  return phase;
}

export function getAuthEpoch(): number {
  return epoch;
}

export function getAuthError(): string {
  return errorMessage;
}

export function setAuthPhase(next: AuthPhase, error = "") {
  if (phase === next && errorMessage === error) return;
  phase = next;
  errorMessage = error;
  emit();
}

/** Invalidates an in-flight status read once the person has chosen. */
export function bumpAuthEpoch() {
  epoch += 1;
  return epoch;
}

export function subscribeAuthPhase(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
