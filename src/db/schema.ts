import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schema Postgres alineado con supabase/migrations/0001_init.sql
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarHue: integer("avatar_hue").notNull().default(78),
  unitSystem: text("unit_system").notNull().default("kg"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const duos = pgTable("duos", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const duoMembers = pgTable(
  "duo_members",
  {
    duoId: uuid("duo_id")
      .notNull()
      .references(() => duos.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
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
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    muscleGroup: text("muscle_group").notNull(),
    equipment: text("equipment").notNull(),
    isUnilateral: boolean("is_unilateral").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    duoId: uuid("duo_id").references(() => duos.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("exercise_catalog_duo_idx").on(t.duoId)],
);

export const workouts = pgTable(
  "workouts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    duoId: uuid("duo_id")
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
    id: uuid("id").primaryKey(),
    workoutId: uuid("workout_id")
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
    id: uuid("id").primaryKey(),
    blockId: uuid("block_id")
      .notNull()
      .references(() => workoutBlocks.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
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
    id: uuid("id").primaryKey(),
    stationId: uuid("station_id")
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
    uniqueIndex("set_logs_station_round_set_uidx").on(
      t.stationId,
      t.roundIndex,
      t.setIndex,
    ),
  ],
);

export const personalRecords = pgTable(
  "personal_records",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exerciseCatalog.id, { onDelete: "cascade" }),
    bestWeightKg: numeric("best_weight_kg").notNull(),
    bestRepsAtWeight: integer("best_reps_at_weight").notNull(),
    estimated1rmKg: numeric("estimated_1rm_kg").notNull(),
    achievedAt: timestamp("achieved_at", { withTimezone: true }).notNull(),
    setLogId: uuid("set_log_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.exerciseId] })],
);

export const reactions = pgTable("reactions", {
  id: uuid("id").primaryKey(),
  workoutId: uuid("workout_id")
    .notNull()
    .references(() => workouts.id, { onDelete: "cascade" }),
  fromUserId: uuid("from_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  body: text("body"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
