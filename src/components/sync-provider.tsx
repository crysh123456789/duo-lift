"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { startGymSync } from "@/lib/sync/engine";

/** Starts sync after the Zustand persist gate has hydrated and the duo cookie is accepted. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname !== "/login";
  useEffect(() => {
    if (!active) return;
    return startGymSync();
  }, [active]);
  return children;
}
