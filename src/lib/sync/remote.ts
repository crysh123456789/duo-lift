import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
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

export async function readDuo(
  admin: SupabaseClient,
  duoId: string,
): Promise<{ data: GymData; remindersFromServer: boolean; tombstones: Tombstone[] } | null> {
  const duoResult = await admin.from("duos").select("id, name, invite_code, created_at").eq("id", duoId).maybeSingle();
  if (duoResult.error) throw new Error(duoResult.error.message);
  if (!duoResult.data) return null;

  const members = await rows<RemoteTables["members"][number]>(
    admin.from("duo_members").select("duo_id, user_id, role, joined_at").eq("duo_id", duoId),
  );
  const userIds = members.map((row) => row.user_id);
  const [users, ownedExercises, globalExercises, workouts, foodDays, loads, reminderResult, tombstoneRows] =
    await Promise.all([
      inChunks<RemoteTables["users"][number]>(userIds, (ids) =>
        admin
          .from("users")
          .select("id, email, display_name, avatar_hue, unit_system, height_cm, weight_kg, nutrition_goal, created_at")
          .in("id", ids),
      ),
      rows<RemoteTables["exercises"][number]>(
        admin
          .from("exercise_catalog")
          .select("id, name, muscle_group, equipment, is_unilateral, created_by_user_id, duo_id")
          .eq("duo_id", duoId),
      ),
      rows<RemoteTables["exercises"][number]>(
        admin
          .from("exercise_catalog")
          .select("id, name, muscle_group, equipment, is_unilateral, created_by_user_id, duo_id")
          .is("duo_id", null),
      ),
      rows<RemoteTables["workouts"][number]>(
        admin
          .from("workouts")
          .select("id, user_id, duo_id, started_at, ended_at, status, notes, perceived_exertion, title")
          .eq("duo_id", duoId),
      ),
      rows<RemoteTables["foodDays"][number]>(
        admin
          .from("food_days")
          .select("id, user_id, date, meals, comment, raw_input, updated_at")
          .eq("duo_id", duoId),
      ),
      inChunks<RemoteTables["loads"][number]>(userIds, (ids) =>
        admin.from("working_loads").select("user_id, exercise_id, weight_kg, reps, reps_right").in("user_id", ids),
      ),
      admin.from("duo_reminders").select("settings").eq("duo_id", duoId).maybeSingle(),
      rows<{ entity: string; entity_id: string }>(
        admin.from("sync_tombstones").select("entity, entity_id").eq("duo_id", duoId),
      ),
    ]);
  if (reminderResult.error) throw new Error(reminderResult.error.message);

  const workoutIds = workouts.map((row) => row.id);
  const blocks = await inChunks<RemoteTables["blocks"][number]>(workoutIds, (ids) =>
    admin
      .from("workout_blocks")
      .select("id, workout_id, position, kind, name, target_rounds, rest_between_rounds_sec, rest_sec")
      .in("workout_id", ids),
  );
  const blockIds = blocks.map((row) => row.id);
  const stations = await inChunks<RemoteTables["stations"][number]>(blockIds, (ids) =>
    admin.from("block_stations").select("id, block_id, exercise_id, position, notes").in("block_id", ids),
  );
  const stationIds = stations.map((row) => row.id);
  const [sets, reactions] = await Promise.all([
    inChunks<RemoteTables["sets"][number]>(stationIds, (ids) =>
      admin
        .from("set_logs")
        .select(
          "id, station_id, round_index, set_index, reps, reps_right, weight_kg, duration_sec, rpe, is_warmup, completed, logged_at",
        )
        .in("station_id", ids),
    ),
    inChunks<RemoteTables["reactions"][number]>(workoutIds, (ids) =>
      admin.from("reactions").select("id, workout_id, from_user_id, kind, body, created_at").in("workout_id", ids),
    ),
  ]);

  const mapped = gymFromRows({
    duo: duoResult.data,
    users,
    members,
    exercises: [...globalExercises, ...ownedExercises],
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

export async function writeDuo(admin: SupabaseClient, data: GymData, tombstones: Tombstone[]) {
  const payload = toSyncPayload(data, tombstones);
  const { error } = await admin.rpc("sync_apply", { payload });
  if (error) throw new Error(error.message);
}

export function requireAdmin() {
  const admin = createAdminClient();
  if (!admin) return null;
  return admin;
}
