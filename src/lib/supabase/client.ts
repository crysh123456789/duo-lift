"use client";

import { createBrowserClient } from "@supabase/ssr";
import { isPublishableConfigured, supabasePublishableKey, supabaseUrl } from "./public-env";

/**
 * Browser Supabase client (publishable / anon key only).
 * Auth cookies come from `@supabase/ssr`. Table access is the signed-in user
 * under RLS. `/api/sync` uses that same session, not the service role.
 */
export function createBrowserSupabaseClient() {
  if (!isPublishableConfigured()) return null;
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
