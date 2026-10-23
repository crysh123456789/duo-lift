import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Postgres schema aligned with supabase/migrations/0001_init.sql
 * and 0002_duo_local_sync.sql.
 * Identifiers are text because the Zustand store uses slugs (`user-cristian`,
 * `ex-banca`) and uuid strings from `nid()`, not auth.users ids.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarHue: integer("avatar_hue").notNull().default(78),
  unitSystem: text("unit_system").notNull().default("kg"),
  heightCm: numeric("height_cm"),
  weightKg: numeric("weight_kg"),
  nutritionGoal: text("nutrition_goal"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const duos = pgTable("duos", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const duoMembers = pgTable(
  "duo_members",
  {
    duoId: text("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.duoId, t.userId] })],
);

export const exerciseCatalog = pgTable(
  "exercise_catalog",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    muscleGroup: text("muscle_group").notNull(),
    equipment: text("equipment").notNull(),
    isUnilateral: boolean("is_unilateral").notNull().default(false),
    createdByUserId: text("created_by_user_id").references(() => users.id),
    duoId: text("duo_id").references(() => duos.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("exercise_catalog_duo_idx").on(t.duoId)],
);

export const workouts = pgTable(
  "workouts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    duoId: text("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    status: text("status").notNull().default("in_progress"),
    notes: text("notes"),
    perceivedExertion: smallint("perceived_exertion"),
    title: text("title"),
  },
  (t) => [
    index("workouts_duo_started_idx").on(t.duoId, t.startedAt),
    index("workouts_user_status_idx").on(t.userId, t.status),
  ],
);

export const workoutBlocks = pgTable(
  "workout_blocks",
  {
    id: text("id").primaryKey(),
    workoutId: text("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind").notNull(),
    name: text("name"),
    targetRounds: integer("target_rounds").notNull().default(1),
    restBetweenRoundsSec: integer("rest_between_rounds_sec"),
    restSec: integer("rest_sec"),
  },
  (t) => [index("workout_blocks_workout_idx").on(t.workoutId, t.position)],
);

export const blockStations = pgTable(
  "block_stations",
  {
    id: text("id").primaryKey(),
    blockId: text("block_id")
      .notNull()
      .references(() => workoutBlocks.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exerciseCatalog.id),
    position: integer("position").notNull(),
    notes: text("notes"),
  },
  (t) => [index("block_stations_block_idx").on(t.blockId, t.position)],
);

export const setLogs = pgTable(
  "set_logs",
  {
    id: text("id").primaryKey(),
    stationId: text("station_id")
      .notNull()
      .references(() => blockStations.id, { onDelete: "cascade" }),
    roundIndex: integer("round_index").notNull(),
    setIndex: integer("set_index").notNull(),
    reps: integer("reps"),
    repsRight: integer("reps_right"),
    weightKg: numeric("weight_kg"),
    durationSec: integer("duration_sec"),
    rpe: numeric("rpe"),
    isWarmup: boolean("is_warmup").notNull().default(false),
    completed: boolean("completed").notNull().default(false),
    loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("set_logs_station_round_set_uidx").on(t.stationId, t.roundIndex, t.setIndex),
  ],
);

/** Not created in SQL yet. Kept so a later PR can store estimated 1RMs. */
export const personalRecords = pgTable(
  "personal_records",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exerciseCatalog.id, { onDelete: "cascade" }),
    bestWeightKg: numeric("best_weight_kg").notNull(),
    bestRepsAtWeight: integer("best_reps_at_weight").notNull(),
    estimated1rmKg: numeric("estimated_1rm_kg").notNull(),
    achievedAt: timestamp("achieved_at", { withTimezone: true }).notNull(),
    setLogId: text("set_log_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.exerciseId] })],
);

export const reactions = pgTable("reactions", {
  id: text("id").primaryKey(),
  workoutId: text("workout_id")
    .notNull()
    .references(() => workouts.id, { onDelete: "cascade" }),
  fromUserId: text("from_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  body: text("body"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const foodDays = pgTable(
  "food_days",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    duoId: text("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    meals: jsonb("meals").notNull(),
    comment: text("comment").notNull().default(""),
    rawInput: text("raw_input"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("food_days_user_date_uidx").on(t.userId, t.date),
    index("food_days_duo_idx").on(t.duoId, t.date),
  ],
);

export const workingLoads = pgTable(
  "working_loads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exerciseCatalog.id, { onDelete: "cascade" }),
    weightKg: numeric("weight_kg").notNull(),
    reps: integer("reps").notNull(),
    repsRight: integer("reps_right"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.exerciseId] })],
);

export const duoReminders = pgTable("duo_reminders", {
  duoId: text("duo_id")
    .primaryKey()
    .references(() => duos.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncTombstones = pgTable(
  "sync_tombstones",
  {
    duoId: text("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.duoId, t.entity, t.entityId] })],
);
