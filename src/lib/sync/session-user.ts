/** Which auth user the sync loop may upload. Null until sign-in settles. */

let userId: string | null = null;
const listeners = new Set<() => void>();

export function getSyncUserId(): string | null {
  return userId;
}

export function setSyncUserId(next: string | null) {
  if (userId === next) return;
  userId = next;
  for (const listener of listeners) listener();
}

export function subscribeSyncUser(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
