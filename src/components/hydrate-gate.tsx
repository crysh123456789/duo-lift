"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { useGymStore } from "@/lib/store";

function subscribeHydration(onChange: () => void) {
  return useGymStore.persist.onFinishHydration(onChange);
}

export function HydrateGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ready = useSyncExternalStore(
    subscribeHydration,
    () => useGymStore.persist.hasHydrated(),
    () => false,
  );

  if (pathname === "/login" || pathname === "/signup") return children;

  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-foreground">
        <div className="text-center">
          <p className="font-mono text-xs tracking-[0.3em] text-accent uppercase">Duo Lift</p>
          <p className="mt-3 text-sm text-muted">Cargando el gym…</p>
        </div>
      </div>
    );
  }

  return children;
}
