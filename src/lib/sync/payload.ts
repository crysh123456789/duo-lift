import { KCAL_TARGET_MAX, PROTEIN_TARGET_MAX, clampDailyTarget } from "@/lib/nutrition";
import type { GymData } from "@/lib/types";
import { canonicalize, snapshotFromState } from "./snapshot";
import { isTombstoneEntity, type Tombstone, type TombstoneEntity } from "./types";

/** Client ids are slugs (`user-cristian`, `ex-banca`) or uuid strings from `nid()`. */
export const SYNC_ID = /^[A-Za-z0-9_-]{1,80}$/;
const PAIR_ID = /^[A-Za-z0-9_-]{1,80}:[A-Za-z0-9_-]{1,80}$/;

export function parseSnapshot(input: unknown): GymData | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<GymData>;
  if (!raw.duo || typeof raw.duo !== "object" || !SYNC_ID.test(raw.duo.id ?? "")) return null;
  return snapshotFromState({
    ...raw,
    duo: {
      id: raw.duo.id,
      name: raw.duo.name?.trim() || "Duo Lift",
      inviteCode: raw.duo.inviteCode?.trim() || "GYM2",
      createdAt: raw.duo.createdAt || new Date(0).toISOString(),
    },
  });
}

export function parseTombstones(input: unknown): Tombstone[] {
  if (!Array.isArray(input)) return [];
  const out: Tombstone[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const entity = String((row as { entity?: unknown }).entity ?? "");
    const id = String((row as { id?: unknown }).id ?? "");
    if (!isTombstoneEntity(entity)) continue;
    if (!validTombstoneId(entity, id)) continue;
    out.push({ entity, id });
  }
  return out;
}

function validTombstoneId(entity: TombstoneEntity, id: string): boolean {
  if (entity === "workingLoads" || entity === "members") return PAIR_ID.test(id);
  return SYNC_ID.test(id);
}

/** Snake-case body for `public.sync_apply`. Child rows keep the snapshot's duo id. */
export function toSyncPayload(data: GymData, tombstones: Tombstone[]) {
  const snapshot = canonicalize(data);
  const duoId = snapshot.duo.id;
  return {
    duo: {
      id: duoId,
      name: snapshot.duo.name,
      invite_code: snapshot.duo.inviteCode,
      created_at: snapshot.duo.createdAt,
    },
    users: snapshot.users
      .filter((row) => SYNC_ID.test(row.id))
      .map((row) => ({
        id: row.id,
        email: row.email,
        display_name: row.displayName,
        avatar_hue: row.avatarHue,
        unit_system: row.unitSystem,
        height_cm: row.heightCm,
        weight_kg: row.weightKg,
        nutrition_goal: row.nutritionGoal,
        protein_target_g: clampDailyTarget(row.proteinTargetG, PROTEIN_TARGET_MAX),
        kcal_target: clampDailyTarget(row.kcalTarget, KCAL_TARGET_MAX),
        created_at: row.createdAt,
      })),
    members: snapshot.members
      .filter((row) => row.duoId === duoId && SYNC_ID.test(row.userId))
      .map((row) => ({
        user_id: row.userId,
        role: row.role,
        joined_at: row.joinedAt,
      })),
    exercises: snapshot.exercises
      .filter((row) => SYNC_ID.test(row.id))
      .map((row) => ({
        id: row.id,
        name: row.name,
        muscle_group: row.muscleGroup,
        equipment: row.equipment,
        is_unilateral: row.isUnilateral,
        created_by_user_id: row.createdByUserId,
        duo_id: row.duoId === duoId ? duoId : null,
      })),
    workouts: snapshot.workouts
      .filter((row) => SYNC_ID.test(row.id) && row.duoId === duoId && SYNC_ID.test(row.userId))
      .map((row) => ({
        id: row.id,
        user_id: row.userId,
        started_at: row.startedAt,
        ended_at: row.endedAt,
        status: row.status,
        notes: row.notes,
        perceived_exertion: row.perceivedExertion,
        title: row.title,
      })),
    blocks: snapshot.blocks
      .filter((row) => SYNC_ID.test(row.id) && SYNC_ID.test(row.workoutId))
      .map((row) => ({
        id: row.id,
        workout_id: row.workoutId,
        position: row.position,
        kind: row.kind,
        name: row.name,
        target_rounds: row.targetRounds,
        rest_between_rounds_sec: row.restBetweenRoundsSec,
        rest_sec: row.restSec,
      })),
    stations: snapshot.stations
      .filter((row) => SYNC_ID.test(row.id) && SYNC_ID.test(row.blockId) && SYNC_ID.test(row.exerciseId))
      .map((row) => ({
        id: row.id,
        block_id: row.blockId,
        exercise_id: row.exerciseId,
        position: row.position,
        notes: row.notes,
      })),
    sets: snapshot.sets
      .filter((row) => SYNC_ID.test(row.id) && SYNC_ID.test(row.stationId))
      .map((row) => ({
        id: row.id,
        station_id: row.stationId,
        round_index: row.roundIndex,
        set_index: row.setIndex,
        reps: row.reps,
        reps_right: row.repsRight,
        weight_kg: row.weightKg,
        duration_sec: row.durationSec,
        rpe: row.rpe,
        is_warmup: row.isWarmup,
        completed: row.completed,
        logged_at: row.loggedAt,
      })),
    reactions: snapshot.reactions
      .filter((row) => SYNC_ID.test(row.id) && SYNC_ID.test(row.workoutId) && SYNC_ID.test(row.fromUserId))
      .map((row) => ({
        id: row.id,
        workout_id: row.workoutId,
        from_user_id: row.fromUserId,
        kind: row.kind,
        body: row.body,
        created_at: row.createdAt,
      })),
    food_days: (snapshot.foodDays ?? [])
      .filter((row) => SYNC_ID.test(row.id) && SYNC_ID.test(row.userId))
      .map((row) => ({
        id: row.id,
        user_id: row.userId,
        date: row.date,
        meals: row.meals,
        comment: row.comment,
        raw_input: row.rawInput,
        updated_at: row.updatedAt,
      })),
    working_loads: Object.entries(snapshot.workingLoads ?? {}).flatMap(([key, load]) => {
      const splitAt = key.indexOf(":");
      if (splitAt <= 0) return [];
      const userId = key.slice(0, splitAt);
      const exerciseId = key.slice(splitAt + 1);
      if (!SYNC_ID.test(userId) || !SYNC_ID.test(exerciseId)) return [];
      return [
        {
          user_id: userId,
          exercise_id: exerciseId,
          weight_kg: load.weightKg,
          reps: load.reps,
          reps_right: load.repsRight,
        },
      ];
    }),
    reminders: snapshot.reminders,
    tombstones: parseTombstones(tombstones),
  };
}
