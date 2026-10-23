import { loadKey } from "@/lib/loads";
import { canonicalize } from "@/lib/sync/snapshot";
import type { GymData, User } from "@/lib/types";

export type AccountProfile = {
  id: string;
  email: string;
  displayName: string;
  heightCm: number | null;
  weightKg: number | null;
};

function hue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

/** Rows this account may upload or show. Other people stay in the phone blob. */
export function scopeToUser(data: GymData, userId: string): GymData {
  const workouts = data.workouts.filter((row) => row.userId === userId);
  const workoutIds = new Set(workouts.map((row) => row.id));
  const blocks = data.blocks.filter((row) => workoutIds.has(row.workoutId));
  const blockIds = new Set(blocks.map((row) => row.id));
  const stations = data.stations.filter((row) => blockIds.has(row.blockId));
  const stationIds = new Set(stations.map((row) => row.id));
  return canonicalize({
    ...data,
    users: data.users.filter((row) => row.id === userId),
    members: data.members.filter((row) => row.userId === userId),
    exercises: data.exercises.filter(
      (row) => row.createdByUserId == null || row.createdByUserId === userId,
    ),
    workouts,
    blocks,
    stations,
    sets: data.sets.filter((row) => stationIds.has(row.stationId)),
    reactions: data.reactions.filter((row) => workoutIds.has(row.workoutId)),
    foodDays: (data.foodDays ?? []).filter((row) => row.userId === userId),
    workingLoads: Object.fromEntries(
      Object.entries(data.workingLoads ?? {}).filter(([key]) => key.startsWith(`${userId}:`)),
    ),
  });
}

/**
 * Puts the synced slice back without dropping the other person's local rows.
 * The duo shell stays on the device; it is not an access key.
 */
export function stitchGym(full: GymData, own: GymData, userId: string): GymData {
  const ownWorkoutIds = new Set(own.workouts.map((row) => row.id));
  const restWorkouts = full.workouts.filter(
    (row) => row.userId !== userId && !ownWorkoutIds.has(row.id),
  );
  const restWorkoutIds = new Set(restWorkouts.map((row) => row.id));
  const restBlocks = full.blocks.filter((row) => restWorkoutIds.has(row.workoutId));
  const restBlockIds = new Set(restBlocks.map((row) => row.id));
  const restStations = full.stations.filter((row) => restBlockIds.has(row.blockId));
  const restStationIds = new Set(restStations.map((row) => row.id));
  const restLoads = Object.fromEntries(
    Object.entries(full.workingLoads ?? {}).filter(([key]) => !key.startsWith(`${userId}:`)),
  );
  return canonicalize({
    duo: full.duo,
    members: full.members,
    reminders: own.reminders,
    users: [...full.users.filter((row) => row.id !== userId), ...own.users],
    exercises: [
      ...full.exercises.filter(
        (row) =>
          row.createdByUserId != null &&
          row.createdByUserId !== userId &&
          !own.exercises.some((ownRow) => ownRow.id === row.id),
      ),
      ...own.exercises,
    ],
    workouts: [...restWorkouts, ...own.workouts],
    blocks: [...restBlocks, ...own.blocks],
    stations: [...restStations, ...own.stations],
    sets: [...full.sets.filter((row) => restStationIds.has(row.stationId)), ...own.sets],
    reactions: [
      ...full.reactions.filter((row) => restWorkoutIds.has(row.workoutId)),
      ...own.reactions,
    ],
    foodDays: [...(full.foodDays ?? []).filter((row) => row.userId !== userId), ...own.foodDays],
    workingLoads: { ...restLoads, ...own.workingLoads },
  });
}

/** Relabels one legacy person onto the auth user. Leaves every other person in place. */
export function rewriteLegacyOwner<T extends GymData>(data: T, fromId: string, toId: string): T {
  if (!fromId || fromId === toId) return data;
  const from = data.users.find((row) => row.id === fromId);
  const to = data.users.find((row) => row.id === toId);
  let users: User[];
  if (to && from) {
    users = data.users
      .filter((row) => row.id !== fromId)
      .map((row) =>
        row.id === toId
          ? {
              ...row,
              displayName: row.displayName?.trim() ? row.displayName : from.displayName,
              heightCm: row.heightCm ?? from.heightCm,
              weightKg: row.weightKg ?? from.weightKg,
              nutritionGoal: row.nutritionGoal ?? from.nutritionGoal,
              unitSystem: row.unitSystem || from.unitSystem,
            }
          : row,
      );
  } else if (from) {
    users = data.users.map((row) => (row.id === fromId ? { ...row, id: toId } : row));
  } else {
    users = data.users;
  }

  const workingLoads: GymData["workingLoads"] = {};
  for (const [key, value] of Object.entries(data.workingLoads ?? {})) {
    const splitAt = key.indexOf(":");
    const owner = splitAt > 0 ? key.slice(0, splitAt) : "";
    const exerciseId = splitAt > 0 ? key.slice(splitAt + 1) : "";
    if (owner === fromId && exerciseId) workingLoads[loadKey(toId, exerciseId)] = value;
    else workingLoads[key] = value;
  }

  return {
    ...data,
    users,
    workouts: data.workouts.map((row) => (row.userId === fromId ? { ...row, userId: toId } : row)),
    foodDays: (data.foodDays ?? []).map((row) =>
      row.userId === fromId ? { ...row, userId: toId } : row,
    ),
    reactions: data.reactions.map((row) =>
      row.fromUserId === fromId ? { ...row, fromUserId: toId } : row,
    ),
    members: data.members.map((row) => (row.userId === fromId ? { ...row, userId: toId } : row)),
    exercises: data.exercises.map((row) =>
      row.createdByUserId === fromId ? { ...row, createdByUserId: toId } : row,
    ),
    workingLoads,
  };
}

/** Ensures the signed-in profile exists locally. Does not delete anyone else's rows. */
export function adoptAccount<T extends GymData>(data: T, profile: AccountProfile): T {
  const existing = data.users.find((row) => row.id === profile.id);
  const users = existing
    ? data.users.map((row) =>
        row.id === profile.id
          ? {
              ...row,
              email: profile.email || row.email,
              displayName: row.displayName?.trim() ? row.displayName : profile.displayName,
              heightCm: row.heightCm ?? profile.heightCm,
              weightKg: row.weightKg ?? profile.weightKg,
            }
          : row,
      )
    : [
        ...data.users,
        {
          id: profile.id,
          email: profile.email,
          displayName: profile.displayName,
          avatarHue: hue(profile.id),
          unitSystem: "kg" as const,
          heightCm: profile.heightCm,
          weightKg: profile.weightKg,
          nutritionGoal: "surplus_muscle" as const,
          createdAt: new Date().toISOString(),
        },
      ];
  return { ...data, users };
}
