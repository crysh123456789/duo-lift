/** Public Supabase env. Safe to read from client components. Never put the service role here. */
export function supabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
}

export function supabasePublishableKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}

export function isPublishableConfigured(): boolean {
  return Boolean(supabaseUrl() && supabasePublishableKey());
}
