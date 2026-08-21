"use client";

import { setDuoUnlocked } from "@/lib/session-flag";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

export function DuoGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const login = pathname === "/login";
  const [remote, setRemote] = useState<{ ok: boolean; configured: boolean } | null>(null);

  useEffect(() => {
    if (login) return;
    let alive = true;
    void fetch("/api/session")
      .then((r) => r.json())
      .then((data: { ok?: boolean; configured?: boolean }) => {
        if (!alive) return;
        setRemote({ ok: Boolean(data.ok), configured: Boolean(data.configured) });
      })
      .catch(() => {
        if (alive) setRemote({ ok: true, configured: false });
      });
    return () => {
      alive = false;
    };
  }, [login, pathname]);

  const state = useMemo(
    () => (login ? { ok: true, configured: true } : remote),
    [login, remote],
  );

  useEffect(() => {
    if (login) {
      setDuoUnlocked(true);
      return;
    }
    if (!state) return;
    if (state.configured && !state.ok) {
      setDuoUnlocked(false);
      router.replace("/login");
      return;
    }
    setDuoUnlocked(true);
  }, [state, login, router]);

  if (login) return children;
  if (!state || (state.configured && !state.ok)) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-foreground">
        <p className="font-mono text-xs tracking-[0.3em] text-accent uppercase">Duo Lift</p>
      </div>
    );
  }

  return (
    <>
      {!state.configured ? (
        <p className="border-b border-line bg-surface px-4 py-2 text-center text-xs text-muted">
          Bitácora privada. Configura <span className="font-mono text-foreground">DUO_LIFT_PASSWORD</span> para
          que nadie más registre como ustedes.
        </p>
      ) : null}
      {children}
    </>
  );
}
