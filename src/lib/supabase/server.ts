import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublishableKey, supabaseUrl } from "./public-env";

/**
 * Cookie-aware Supabase client for a future Auth session.
 * The duo login cookie (`duo_session`) is separate and is what `/api/sync` checks.
 * This client uses the anon/publishable key, so RLS still denies table access
 * until Seguridad restores grants.
 */
export async function createSupabaseServerClient() {
  const url = supabaseUrl();
  const key = supabasePublishableKey();
  if (!url || !key) return null;
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot always write cookies. Proxy would, once Auth exists.
        }
      },
    },
  });
}
