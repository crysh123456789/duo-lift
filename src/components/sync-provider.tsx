"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { isAuthScreen } from "@/lib/auth/paths";
import { startGymSync } from "@/lib/sync/engine";

/** Starts sync after hydration, once the signed-in user is in the app. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = !isAuthScreen(pathname);
  useEffect(() => {
    if (!active) return;
    return startGymSync();
  }, [active]);
  return children;
}
