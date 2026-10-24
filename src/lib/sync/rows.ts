import { loadKey } from "@/lib/loads";
import { KCAL_TARGET_MAX, PROTEIN_TARGET_MAX, clampDailyTarget, normalizeMealLog } from "@/lib/nutrition";
import type {
  BlockKind,
  Equipment,
  GymData,
  MuscleGroup,
  NutritionGoal,
  ReactionKind,
  UnitSystem,
  WorkoutStatus,
} from "@/lib/types";
import { canonicalize, normalizeReminders } from "./snapshot";

export type DuoRow = {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
};

export type UserRow = {
  id: string;
  email: string;
  display_name: string;
  avatar_hue: number | null;
  unit_system: string | null;
  height_cm: string | number | null;
  weight_kg: string | number | null;
  nutrition_goal: string | null;
  protein_target_g?: string | number | null;
  kcal_target?: string | number | null;
  created_at: string;
};

export type MemberRow = {
  duo_id: string;
  user_id: string;
  role: string | null;
  joined_at: string;
};

export type ExerciseRow = {
  id: string;
  name: string;
  muscle_group: string;
  equipment: string;
  is_unilateral: boolean | null;
  created_by_user_id: string | null;
  duo_id: string | null;
};

export type WorkoutRow = {
  id: string;
  user_id: string;
  duo_id: string;
  started_at: string;
  ended_at: string | null;
  status: string | null;
  notes: string | null;
  perceived_exertion: number | null;
  title: string | null;
};

export type BlockRow = {
  id: string;
  workout_id: string;
  position: number;
  kind: string;
  name: string | null;
  target_rounds: number | null;
  rest_between_rounds_sec: number | null;
  rest_sec: number | null;
};

export type StationRow = {
  id: string;
  block_id: string;
  exercise_id: string;
  position: number;
  notes: string | null;
};

export type SetRow = {
  id: string;
  station_id: string;
  round_index: number;
  set_index: number;
  reps: number | null;
  reps_right: number | null;
  weight_kg: string | number | null;
  duration_sec: number | null;
  rpe: string | number | null;
  is_warmup: boolean | null;
  completed: boolean | null;
  logged_at: string;
};

export type ReactionRow = {
  id: string;
  workout_id: string;
  from_user_id: string;
  kind: string;
  body: string | null;
  created_at: string;
};

export type FoodDayRow = {
  id: string;
  user_id: string;
  date: string;
  /** Legacy string slots or v2 `{ time, items, note }` objects. */
  meals: unknown;
  comment: string | null;
  raw_input: string | null;
  updated_at: string;
};

export type LoadRow = {
  user_id: string;
  exercise_id: string;
  weight_kg: string | number;
  reps: number;
  reps_right: number | null;
};

export type ReminderRow = {
  settings: GymData["reminders"] | null;
};

export type RemoteTables = {
  duo: DuoRow;
  users: UserRow[];
  members: MemberRow[];
  exercises: ExerciseRow[];
  workouts: WorkoutRow[];
  blocks: BlockRow[];
  stations: StationRow[];
  sets: SetRow[];
  reactions: ReactionRow[];
  foodDays: FoodDayRow[];
  loads: LoadRow[];
  reminders: ReminderRow | null;
};

const MUSCLES = new Set<MuscleGroup>(["legs", "chest", "back", "shoulders", "arms", "core", "other"]);
const EQUIPMENT = new Set<Equipment>(["barbell", "dumbbell", "machine", "cable", "bodyweight", "other"]);
const STATUSES = new Set<WorkoutStatus>(["in_progress", "completed", "abandoned"]);
const KINDS = new Set<BlockKind>(["straight", "circuit", "rest"]);
const REACTIONS = new Set<ReactionKind>(["fire", "comment"]);
const GOALS = new Set<NutritionGoal>(["surplus_muscle", "maintain", "cut"]);

export function iso(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function num(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function oneOf<T extends string>(value: string | null | undefined, allowed: Set<T>, fallback: T): T {
  return value && allowed.has(value as T) ? (value as T) : fallback;
}

export function gymFromRows(tables: RemoteTables): { data: GymData; remindersFromServer: boolean } {
  const workingLoads: GymData["workingLoads"] = {};
  for (const row of tables.loads) {
    const weight = num(row.weight_kg);
    if (weight == null) continue;
    workingLoads[loadKey(row.user_id, row.exercise_id)] = {
      weightKg: weight,
      reps: row.reps ?? 8,
      repsRight: row.reps_right,
    };
  }

  const remindersFromServer = Boolean(tables.reminders?.settings);
  const data = canonicalize({
    duo: {
      id: tables.duo.id,
      name: tables.duo.name,
      inviteCode: tables.duo.invite_code,
      createdAt: iso(tables.duo.created_at) ?? new Date(0).toISOString(),
    },
    users: tables.users.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name ?? "",
      avatarHue: row.avatar_hue ?? 78,
      unitSystem: row.unit_system === "lb" ? "lb" : ("kg" satisfies UnitSystem),
      heightCm: num(row.height_cm),
      weightKg: num(row.weight_kg),
      nutritionGoal: row.nutrition_goal && GOALS.has(row.nutrition_goal as NutritionGoal)
        ? (row.nutrition_goal as NutritionGoal)
        : null,
      proteinTargetG: clampDailyTarget(row.protein_target_g, PROTEIN_TARGET_MAX),
      kcalTarget: clampDailyTarget(row.kcal_target, KCAL_TARGET_MAX),
      createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    })),
    members: tables.members.map((row) => ({
      duoId: row.duo_id,
      userId: row.user_id,
      role: row.role === "owner" ? "owner" : "member",
      joinedAt: iso(row.joined_at) ?? new Date(0).toISOString(),
    })),
    exercises: tables.exercises.map((row) => ({
      id: row.id,
      name: row.name,
      muscleGroup: oneOf(row.muscle_group, MUSCLES, "other"),
      equipment: oneOf(row.equipment, EQUIPMENT, "other"),
      isUnilateral: Boolean(row.is_unilateral),
      createdByUserId: row.created_by_user_id,
      duoId: row.duo_id,
    })),
    workouts: tables.workouts.map((row) => ({
      id: row.id,
      userId: row.user_id,
      duoId: row.duo_id,
      startedAt: iso(row.started_at) ?? new Date(0).toISOString(),
      endedAt: iso(row.ended_at),
      status: oneOf(row.status, STATUSES, "in_progress"),
      notes: row.notes,
      perceivedExertion: row.perceived_exertion,
      title: row.title,
    })),
    blocks: tables.blocks.map((row) => ({
      id: row.id,
      workoutId: row.workout_id,
      position: row.position,
      kind: oneOf(row.kind, KINDS, "straight"),
      name: row.name,
      targetRounds: row.target_rounds ?? 1,
      restBetweenRoundsSec: row.rest_between_rounds_sec,
      restSec: row.rest_sec,
    })),
    stations: tables.stations.map((row) => ({
      id: row.id,
      blockId: row.block_id,
      exerciseId: row.exercise_id,
      position: row.position,
      notes: row.notes,
    })),
    sets: tables.sets.map((row) => ({
      id: row.id,
      stationId: row.station_id,
      roundIndex: row.round_index,
      setIndex: row.set_index,
      reps: row.reps,
      repsRight: row.reps_right,
      weightKg: num(row.weight_kg),
      durationSec: row.duration_sec,
      rpe: num(row.rpe),
      isWarmup: Boolean(row.is_warmup),
      completed: Boolean(row.completed),
      loggedAt: iso(row.logged_at) ?? new Date(0).toISOString(),
    })),
    reactions: tables.reactions.map((row) => ({
      id: row.id,
      workoutId: row.workout_id,
      fromUserId: row.from_user_id,
      kind: oneOf(row.kind, REACTIONS, "comment"),
      body: row.body,
      createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    })),
    workingLoads,
    foodDays: tables.foodDays.map((row) => ({
      id: row.id,
      userId: row.user_id,
      date: row.date,
      meals: normalizeMealLog(row.meals),
      comment: row.comment ?? "",
      rawInput: row.raw_input,
      updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
    })),
    reminders: remindersFromServer ? normalizeReminders(tables.reminders?.settings) : normalizeReminders(null),
  });

  return { data, remindersFromServer };
}
