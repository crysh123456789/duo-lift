import type { SupabaseClient } from "@supabase/supabase-js";

/** v1 recovery links always return to gamma. Never the current origin. */
export const PASSWORD_RECOVERY_REDIRECT_TO = "https://duo-lift-gamma.vercel.app/reset";

const FLOW_ID = /^[a-zA-Z0-9_-]{8,64}$/;

export type RecoveryArrival =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "code"; code: string; flowId?: string }
  | { kind: "token"; tokenHash: string };

export type RecoveryOpen = "ready" | "invalid" | "failed";

/**
 * Reads a recovery callback URL. Tokens stay in the return value for the exchange
 * and must not be logged or rendered.
 */
export function classifyRecoveryArrival(href: string): RecoveryArrival {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
  const error = url.searchParams.get("error") || hash.get("error");
  const errorCode = url.searchParams.get("error_code") || hash.get("error_code");
  const errorDescription = url.searchParams.get("error_description") || hash.get("error_description");
  if (error || errorCode || errorDescription) return { kind: "invalid" };

  const tokenHash = url.searchParams.get("token_hash")?.trim() ?? "";
  const type = url.searchParams.get("type") || hash.get("type");
  if (tokenHash && type === "recovery") return { kind: "token", tokenHash };

  const code = url.searchParams.get("code")?.trim() ?? "";
  if (code) {
    const rawFlow = url.searchParams.get("sb_flow_id")?.trim() ?? "";
    return { kind: "code", code, ...(FLOW_ID.test(rawFlow) ? { flowId: rawFlow } : {}) };
  }

  // Implicit hash tokens are not a PKCE session. Treat them as a dead link.
  if (hash.get("access_token") || hash.get("refresh_token") || type === "recovery") {
    return { kind: "invalid" };
  }

  return { kind: "none" };
}

export function recoveryAttemptKey(arrival: RecoveryArrival): string {
  if (arrival.kind === "code") return `code:${arrival.flowId ?? ""}:${arrival.code}`;
  if (arrival.kind === "token") return `token:${arrival.tokenHash}`;
  return arrival.kind;
}

function isTransient(error: { status?: number; name?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.name === "AuthRetryableFetchError") return true;
  const status = error.status ?? 0;
  if (status === 429 || status >= 500) return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("failed to fetch") || message.includes("network");
}

/**
 * Turns the email link into a recovery session, then the page calls `updateUser`.
 * A code is one-shot. Callers dedupe so React Strict Mode does not exchange it twice.
 */
export async function openRecoverySession(
  supabase: SupabaseClient,
  arrival: RecoveryArrival,
  currentHref: () => string,
): Promise<RecoveryOpen> {
  if (arrival.kind === "none" || arrival.kind === "invalid") return "invalid";

  let recovery = false;
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && session) recovery = true;
  });

  try {
    const initialized = await supabase.auth.initialize();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (recovery) return "ready";

    if (arrival.kind === "token") {
      const { data, error } = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash: arrival.tokenHash,
      });
      if (!error && data.session) return "ready";
      return isTransient(error) ? "failed" : "invalid";
    }

    let codeNow: string | null = null;
    try {
      codeNow = new URL(currentHref()).searchParams.get("code");
    } catch {
      return "failed";
    }

    if (codeNow !== arrival.code) {
      const { data } = await supabase.auth.getSession();
      if (data.session) return "ready";
      return isTransient(initialized.error) ? "failed" : "invalid";
    }

    const exchanged = await supabase.auth.exchangeCodeForSession(
      arrival.code,
      arrival.flowId ? { flowId: arrival.flowId } : undefined,
    );
    if (recovery) return "ready";
    if (exchanged.error || !exchanged.data.session) {
      return isTransient(exchanged.error) ? "failed" : "invalid";
    }
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // A non-recovery session must not open the password form.
    }
    return "invalid";
  } catch {
    return "failed";
  } finally {
    subscription.unsubscribe();
  }
}
