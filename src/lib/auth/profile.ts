import type { AccountProfile } from "./scope";

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Display fields for the local profile shell.
 * user_metadata is not an authorization source; RLS uses auth.uid().
 */
export function profileFromAuthUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): AccountProfile {
  const meta = user.user_metadata ?? {};
  const email = user.email ?? "";
  const rawName = typeof meta.display_name === "string" ? meta.display_name.trim() : "";
  return {
    id: user.id,
    email,
    displayName: rawName || email.split("@")[0] || "Tú",
    heightCm: optionalNumber(meta.height_cm),
    weightKg: optionalNumber(meta.weight_kg),
  };
}
