/** Screens that render outside the gym shell and without a session redirect. */

const GUEST_AUTH_PATHS = new Set(["/login", "/signup", "/forgot"]);

export function isAuthScreen(pathname: string): boolean {
  return GUEST_AUTH_PATHS.has(pathname) || pathname === "/reset";
}

/**
 * Signed-in people bounce home from these screens.
 * `/reset` stays open: the recovery code becomes a session before the new password is saved.
 */
export function isGuestOnlyAuthScreen(pathname: string): boolean {
  return GUEST_AUTH_PATHS.has(pathname);
}
