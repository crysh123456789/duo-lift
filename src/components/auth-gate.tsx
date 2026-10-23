"use client";

import { settleSignedInUser } from "@/lib/auth/enter";
import { isAuthScreen } from "@/lib/auth/paths";
import {
  getAuthEpoch,
  getAuthError,
  getAuthPhase,
  setAuthPhase,
  subscribeAuthPhase,
  bumpAuthEpoch,
} from "@/lib/auth/phase";
import { setDuoUnlocked } from "@/lib/session-flag";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { setSyncUserId } from "@/lib/sync/session-user";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background text-foreground">
      <p className="font-mono text-xs tracking-[0.3em] text-accent uppercase">Duo Lift</p>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const authPage = isAuthScreen(pathname);
  const phase = useSyncExternalStore(subscribeAuthPhase, getAuthPhase, () => "boot" as const);
  const error = useSyncExternalStore(subscribeAuthPhase, getAuthError, () => "");

  useEffect(() => {
    if (authPage) return;
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setSyncUserId(null);
      setDuoUnlocked(false);
      setAuthPhase("anon");
      return;
    }
    let alive = true;

    async function resolve(user: {
      id: string;
      email?: string | null;
      user_metadata?: Record<string, unknown> | null;
    }) {
      const ticket = getAuthEpoch();
      try {
        const next = await settleSignedInUser(supabase!, user);
        if (!alive || ticket !== getAuthEpoch()) return;
        setAuthPhase(next);
      } catch (err) {
        if (!alive || ticket !== getAuthEpoch()) return;
        const message = err instanceof Error ? err.message : "";
        setAuthPhase("error", message);
      }
    }

    void supabase.auth.getUser().then(({ data }) => {
      if (!alive) return;
      if (!data.user) {
        setSyncUserId(null);
        setDuoUnlocked(false);
        setAuthPhase("anon");
        return;
      }
      void resolve(data.user);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (event === "SIGNED_OUT" || !session?.user) {
        bumpAuthEpoch();
        setSyncUserId(null);
        setDuoUnlocked(false);
        setAuthPhase("anon");
        return;
      }
      if (event === "SIGNED_IN") {
        const user = session.user;
        queueMicrotask(() => {
          if (alive) void resolve(user);
        });
      }
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [authPage]);

  useEffect(() => {
    if (authPage || phase === "boot" || phase === "error") return;
    if (phase === "anon") {
      router.replace("/login");
      return;
    }
    if (phase === "claim" && pathname !== "/claim") {
      router.replace("/claim");
      return;
    }
    if (phase === "in" && pathname === "/claim") {
      router.replace("/");
    }
  }, [authPage, phase, pathname, router]);

  if (authPage) return children;

  if (phase === "error") {
    return (
      <div className="grid min-h-dvh place-items-center bg-background px-4 text-foreground">
        <div className="max-w-sm text-center">
          <p className="font-mono text-xs tracking-[0.3em] text-accent uppercase">Duo Lift</p>
          <p className="mt-3 text-sm">
            {error.includes("not_authenticated")
              ? "La sesión caducó. Entra de nuevo."
              : "No se pudo comprobar el historial."}
          </p>
          <button
            type="button"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink"
            onClick={() => window.location.reload()}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (phase === "boot" || phase === "anon" || (phase === "claim" && pathname !== "/claim")) {
    return <Splash />;
  }

  return children;
}
