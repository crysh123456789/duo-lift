"use client";

import { useMemo } from "react";
import { useGymStore } from "@/lib/store";
import type { GymData } from "@/lib/types";
import { scopeToUser } from "./scope";

/** Gym rows the signed-in person may see. The other history stays in the phone cache. */
export function useOwnGym(): GymData & { activeUserId: string } {
  const state = useGymStore();
  const activeUserId = state.activeUserId;
  return useMemo(
    () => ({ ...scopeToUser(state, activeUserId), activeUserId }),
    [state, activeUserId],
  );
}
