import { duoPassword } from "@/lib/duo-lock";
import { isPublishableConfigured } from "@/lib/supabase/public-env";

export type SyncGate = {
  /** Uploads are allowed only when every production guard is on. */
  enabled: boolean;
  /** URL + service role are present, whether or not the flag is on. */
  configured: boolean;
  publishable: boolean;
  password: boolean;
  flag: boolean;
};

/**
 * Real localStorage is not uploaded until all of these are true:
 * the sync flag, the project URL, the server-only service role, and the duo password.
 * An open deployment (no `DUO_LIFT_PASSWORD` outside development) cannot sync.
 */
export function syncGate(): SyncGate {
  const flag = /^(1|true|yes)$/i.test(process.env.DUO_LIFT_SYNC_ENABLED?.trim() ?? "");
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  const password = Boolean(duoPassword());
  return {
    enabled: flag && configured && password,
    configured,
    publishable: isPublishableConfigured(),
    password,
    flag,
  };
}
