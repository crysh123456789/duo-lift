import { DEFAULT_REMINDERS } from "@/lib/reminders";
import { setDuoUnlocked } from "@/lib/session-flag";
import { useGymStore } from "@/lib/store";
import { setSyncUserId } from "@/lib/sync/session-user";
import { snapshotFromState } from "@/lib/sync/snapshot";
import { setSyncStorageUser } from "@/lib/sync/storage";
import type { GymData } from "@/lib/types";
import { isAuthUserId } from "./constants";
import { profileFromAuthUser } from "./profile";
import { attachClaimedHistory, type AccountProfile } from "./scope";

export type AuthLike = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

type RpcResult = { data: unknown; error: { message: string } | null };

export type StatusClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
};

/** Writes the signed-in profile into the phone cache. Does not drop other people. */
export function applyAccountLocally(profile: AccountProfile, next: GymData) {
  const state = useGymStore.getState();
  const resetReminders = isAuthUserId(state.activeUserId) && state.activeUserId !== profile.id;
  useGymStore.setState({
    users: next.users,
    members: next.members,
    exercises: next.exercises,
    workouts: next.workouts,
    blocks: next.blocks,
    stations: next.stations,
    sets: next.sets,
    reactions: next.reactions,
    foodDays: next.foodDays,
    workingLoads: next.workingLoads,
    activeUserId: profile.id,
    ...(resetReminders ? { reminders: DEFAULT_REMINDERS } : {}),
  });
  setSyncStorageUser(profile.id);
  setSyncUserId(profile.id);
  setDuoUnlocked(true);
}

/**
 * Asks the server whether this account still has to choose a legacy history.
 * A missing decision with nothing left to claim is recorded as clean, server-side.
 */
export async function settleSignedInUser(supabase: StatusClient, user: AuthLike): Promise<"claim" | "in"> {
  const { data, error } = await supabase.rpc("legacy_history_status");
  if (error) throw new Error(error.message);
  const status = (data ?? {}) as { decision?: string | null; open?: unknown };
  const decision = typeof status.decision === "string" ? status.decision : null;
  const open = Array.isArray(status.open) ? status.open.filter((item) => typeof item === "string") : [];
  if (!decision && open.length > 0) {
    setSyncUserId(null);
    setDuoUnlocked(false);
    return "claim";
  }
  if (!decision) {
    const declined = await supabase.rpc("decline_legacy_history");
    if (declined.error) throw new Error(declined.error.message);
  }
  const profile = profileFromAuthUser(user);
  applyAccountLocally(
    profile,
    attachClaimedHistory(snapshotFromState(useGymStore.getState()), profile, decision),
  );
  return "in";
}
