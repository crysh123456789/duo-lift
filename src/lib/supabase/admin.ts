import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./public-env";

/** Service role. Bypasses RLS. Import only from server route handlers. */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("El cliente admin de Supabase solo puede usarse en el servidor.");
  }
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
