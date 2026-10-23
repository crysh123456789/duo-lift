"use client";

import { createBrowserClient } from "@supabase/ssr";
import { isPublishableConfigured, supabasePublishableKey, supabaseUrl } from "./public-env";

/**
 * Browser Supabase client (anon / publishable key only).
 * Direct table writes stay closed: migration 0002 revokes anon grants.
 * Gym data is synced through `/api/sync`, which checks the duo cookie and
 * uses the service role only when `DUO_LIFT_SYNC_ENABLED=true`.
 */
export function createBrowserSupabaseClient() {
  if (!isPublishableConfigured()) return null;
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
