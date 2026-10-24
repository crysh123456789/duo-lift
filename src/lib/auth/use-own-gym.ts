"use client";

import { useMemo } from "react";
import { omitSeedHistory } from "@/lib/seed";
import { useGymStore } from "@/lib/store";
import type { GymData } from "@/lib/types";
import { scopeToUser } from "./scope";

/** Gym rows the signed-in person may see. Demo ids never enter this view. */
export function useOwnGym(): GymData & { activeUserId: string } {
  const state = useGymStore();
  const activeUserId = state.activeUserId;
  return useMemo(
    () => ({ ...scopeToUser(omitSeedHistory(state), activeUserId), activeUserId }),
    [state, activeUserId],
  );
}
