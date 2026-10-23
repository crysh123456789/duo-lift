"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { startGymSync } from "@/lib/sync/engine";

/** Starts the local-first sync loop after the Zustand persist gate has hydrated. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === "/login") return;
    return startGymSync();
  }, [pathname]);
  return children;
}
