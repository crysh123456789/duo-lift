import type { SupabaseClient } from "@supabase/supabase-js";
import type { GymData } from "@/lib/types";
import { toSyncPayload } from "./payload";
import { gymFromRows, type RemoteTables } from "./rows";
import { isTombstoneEntity, type Tombstone } from "./types";

async function rows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function inChunks<T>(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const out: T[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    out.push(...(await rows(run(ids.slice(index, index + 100)))));
  }
  return out;
}

/**
 * Reads the signed-in user's rows through their JWT. RLS is the gate.
 * The explicit user id filter is a second check. duo id is not an input.
 */
export async function readOwn(
  client: SupabaseClient,
  userId: string,
): Promise<{ data: GymData; remindersFromServer: boolean; tombstones: Tombstone[] }> {
  const [users, exercises, workouts, foodDays, loads, reminderResult, tombstoneRows] = await Promise.all([
    rows<RemoteTables["users"][number]>(
      client
        .from("users")
        .select("id, email, display_name, avatar_hue, unit_system, height_cm, weight_kg, nutrition_goal, created_at")
        .eq("id", userId),
    ),
    rows<RemoteTables["exercises"][number]>(
      client
        .from("exercise_catalog")
        .select("id, name, muscle_group, equipment, is_unilateral, created_by_user_id, duo_id"),
    ),
    rows<RemoteTables["workouts"][number]>(
      client
        .from("workouts")
        .select("id, user_id, duo_id, started_at, ended_at, status, notes, perceived_exertion, title")
        .eq("user_id", userId),
    ),
    rows<RemoteTables["foodDays"][number]>(
      client
        .from("food_days")
        .select("id, user_id, date, meals, comment, raw_input, updated_at")
        .eq("user_id", userId),
    ),
    rows<RemoteTables["loads"][number]>(
      client.from("working_loads").select("user_id, exercise_id, weight_kg, reps, reps_right").eq("user_id", userId),
    ),
    client.from("user_reminders").select("settings").eq("user_id", userId).maybeSingle(),
    rows<{ entity: string; entity_id: string }>(
      client.from("user_tombstones").select("entity, entity_id").eq("user_id", userId),
    ),
  ]);
  if (reminderResult.error) throw new Error(reminderResult.error.message);

  const workoutIds = workouts.map((row) => row.id);
  const blocks = await inChunks<RemoteTables["blocks"][number]>(workoutIds, (ids) =>
    client
      .from("workout_blocks")
      .select("id, workout_id, position, kind, name, target_rounds, rest_between_rounds_sec, rest_sec")
      .in("workout_id", ids),
  );
  const blockIds = blocks.map((row) => row.id);
  const stations = await inChunks<RemoteTables["stations"][number]>(blockIds, (ids) =>
    client.from("block_stations").select("id, block_id, exercise_id, position, notes").in("block_id", ids),
  );
  const stationIds = stations.map((row) => row.id);
  const [sets, reactions] = await Promise.all([
    inChunks<RemoteTables["sets"][number]>(stationIds, (ids) =>
      client
        .from("set_logs")
        .select(
          "id, station_id, round_index, set_index, reps, reps_right, weight_kg, duration_sec, rpe, is_warmup, completed, logged_at",
        )
        .in("station_id", ids),
    ),
    inChunks<RemoteTables["reactions"][number]>(workoutIds, (ids) =>
      client.from("reactions").select("id, workout_id, from_user_id, kind, body, created_at").in("workout_id", ids),
    ),
  ]);

  const duoId = workouts.find((row) => row.duo_id)?.duo_id ?? "duo-1";
  const mapped = gymFromRows({
    duo: {
      id: duoId,
      name: "Duo Lift",
      invite_code: "GYM2",
      created_at: new Date(0).toISOString(),
    },
    users,
    members: [],
    exercises,
    workouts,
    blocks,
    stations,
    sets,
    reactions,
    foodDays,
    loads,
    reminders: reminderResult.data,
  });
  const tombstones: Tombstone[] = [];
  for (const row of tombstoneRows) {
    if (isTombstoneEntity(row.entity)) tombstones.push({ entity: row.entity, id: row.entity_id });
  }
  return { ...mapped, tombstones };
}

export async function writeOwn(client: SupabaseClient, data: GymData, tombstones: Tombstone[]) {
  const payload = toSyncPayload(data, tombstones);
  const { error } = await client.rpc("sync_apply", { payload });
  if (error) throw new Error(error.message);
}
