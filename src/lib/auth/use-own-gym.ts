"use client";

import { useMemo } from "react";
import { omitDemo } from "@/lib/seed";
import { useGymStore } from "@/lib/store";
import type { GymData } from "@/lib/types";
import { scopeToUser } from "./scope";

/** Gym rows the signed-in person may see. Example sessions stay out of this view. */
export function useOwnGym(): GymData & { activeUserId: string } {
  const state = useGymStore();
  const activeUserId = state.activeUserId;
  return useMemo(
    () => ({ ...scopeToUser(omitDemo(state), activeUserId), activeUserId }),
    [state, activeUserId],
  );
}
