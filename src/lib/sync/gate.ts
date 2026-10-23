import { isPublishableConfigured } from "@/lib/supabase/public-env";

export type SyncGate = {
  /** Uploads run when the flag is on and the browser can use the publishable key. */
  enabled: boolean;
  /** URL + anon/publishable key are present. The service role is not required. */
  configured: boolean;
  publishable: boolean;
  flag: boolean;
};

/**
 * Sync follows the signed-in Supabase user. The shared duo password is not a guard.
 * `SUPABASE_SERVICE_ROLE_KEY` is not part of this path.
 */
export function syncGate(): SyncGate {
  const flag = /^(1|true|yes)$/i.test(process.env.DUO_LIFT_SYNC_ENABLED?.trim() ?? "");
  const publishable = isPublishableConfigured();
  return {
    enabled: flag && publishable,
    configured: publishable,
    publishable,
    flag,
  };
}
