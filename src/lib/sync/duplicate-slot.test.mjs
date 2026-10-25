import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { toSyncPayload } from "./payload.ts";
import { prepareSyncSnapshot } from "./round.ts";

// Local PGlite only. Loads sync_apply from 0014 and the live unique index from 0008.
// Never connects to production and never creates users or rows there.

const migration = readFileSync(
  new URL("../../../supabase/migrations/0014_profile_weight_height.sql", import.meta.url),
  "utf8",
);
const fnStart = migration.indexOf("create or replace function public.strip_meal_item");
const grant = "grant execute on function public.sync_apply(jsonb) to authenticated;";
const grantAt = migration.indexOf(grant);
const syncApply0014 = migration.slice(fnStart, grantAt + grant.length);

const OWNER = "11111111-1111-4111-8111-111111111111";

const reminders = {
  enabled: false,
  lastFired: {},
  meals: {
    desayuno: { enabled: true, time: "08:00" },
    mediaManana: { enabled: true, time: "11:00" },
    almuerzo: { enabled: true, time: "13:00" },
    mediaTarde: { enabled: true, time: "16:30" },
    cena: { enabled: true, time: "20:00" },
  },
  gym: { enabled: true, time: "18:00" },
};

function gym(sets) {
  return {
    users: [
      {
        id: "user-cristian",
        email: "cristian@duo.lift",
        displayName: "Cristian",
        avatarHue: 78,
        unitSystem: "kg",
        heightCm: 167,
        weightKg: 60,
        nutritionGoal: "surplus_muscle",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    duo: { id: "duo-1", name: "Duo Lift", inviteCode: "GYM2", createdAt: "2026-01-01T00:00:00.000Z" },
    members: [{ duoId: "duo-1", userId: "user-cristian", role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" }],
    exercises: [],
    workouts: [],
    blocks: [],
    stations: [],
    sets,
    reactions: [],
    workingLoads: {},
    foodDays: [],
    reminders,
  };
}

function setRow(id, loggedAt) {
  return {
    id,
    stationId: "st-1",
    roundIndex: 1,
    setIndex: 1,
    reps: 8,
    repsRight: null,
    weightKg: 20,
    durationSec: null,
    rpe: null,
    isWarmup: false,
    completed: true,
    loggedAt,
  };
}

function schema() {
  return `
    create schema if not exists auth;
    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create or replace function auth.jwt()
    returns jsonb
    language sql
    stable
    as $$
      select case
        when coalesce(current_setting('request.jwt.claims', true), '') = '' then '{}'::jsonb
        else current_setting('request.jwt.claims', true)::jsonb
      end;
    $$;

    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;

    create table public.users (
      id text primary key,
      email text not null unique,
      display_name text not null,
      avatar_hue integer not null default 78,
      unit_system text not null default 'kg',
      height_cm numeric,
      weight_kg numeric,
      nutrition_goal text,
      protein_target_g integer,
      kcal_target integer,
      targets_updated_at timestamptz,
      profile_updated_at timestamptz,
      created_at timestamptz not null default now()
    );
    create table public.exercise_catalog (
      id text primary key,
      name text,
      muscle_group text,
      equipment text,
      is_unilateral boolean,
      created_by_user_id text,
      duo_id text,
      deleted_at timestamptz
    );
    create table public.workouts (
      id text primary key,
      user_id text not null,
      duo_id text not null,
      started_at timestamptz not null default now(),
      ended_at timestamptz,
      status text,
      notes text,
      perceived_exertion smallint,
      title text,
      deleted_at timestamptz
    );
    create table public.workout_blocks (
      id text primary key,
      workout_id text not null,
      position integer not null default 1,
      kind text not null default 'straight',
      name text,
      target_rounds integer,
      rest_between_rounds_sec integer,
      rest_sec integer,
      deleted_at timestamptz
    );
    create table public.block_stations (
      id text primary key,
      block_id text not null,
      exercise_id text not null,
      position integer not null default 1,
      notes text,
      deleted_at timestamptz
    );
    create table public.set_logs (
      id text primary key,
      station_id text not null,
      round_index integer not null,
      set_index integer not null,
      reps integer,
      reps_right integer,
      weight_kg numeric,
      duration_sec integer,
      rpe numeric,
      is_warmup boolean not null default false,
      completed boolean not null default false,
      logged_at timestamptz not null default now(),
      deleted_at timestamptz
    );
    create unique index set_logs_station_round_set_live_uidx
      on public.set_logs (station_id, round_index, set_index)
      where deleted_at is null;
    create table public.reactions (
      id text primary key,
      workout_id text not null,
      from_user_id text not null,
      kind text,
      body text,
      created_at timestamptz,
      deleted_at timestamptz
    );
    create table public.food_days (
      id text primary key,
      user_id text not null,
      duo_id text,
      date text,
      meals jsonb,
      comment text,
      raw_input text,
      updated_at timestamptz,
      deleted_at timestamptz
    );
    create table public.working_loads (
      user_id text not null,
      exercise_id text not null,
      weight_kg numeric,
      reps integer,
      reps_right integer,
      updated_at timestamptz,
      deleted_at timestamptz,
      primary key (user_id, exercise_id)
    );
    create table public.user_reminders (
      user_id text primary key references public.users (id) on delete cascade,
      settings jsonb not null,
      updated_at timestamptz not null default now()
    );

    insert into public.users (id, email, display_name) values
      ('${OWNER}', 'cristian@duo.lift', 'Cristian');
    insert into public.workouts (id, user_id, duo_id, status) values
      ('w-1', '${OWNER}', 'duo-1', 'in_progress');
    insert into public.workout_blocks (id, workout_id) values
      ('b-1', 'w-1');
    insert into public.block_stations (id, block_id, exercise_id) values
      ('st-1', 'b-1', 'ex-1');
  `;
}

describe("sync_apply 0014 duplicate slot", () => {
  test("el snapshot colapsado no dispara 23505", async () => {
    assert.match(syncApply0014, /create or replace function public\.sync_apply\(payload jsonb\)/);
    assert.match(syncApply0014, /on conflict \(id\) do update set/);
    assert.equal(/soft_delete_own_set/.test(syncApply0014), false);

    const db = new PGlite();
    await db.exec(schema());
    await db.exec(syncApply0014);
    const definition = await db.query(
      `select pg_get_functiondef('public.sync_apply(jsonb)'::regprocedure) as src`,
    );
    const src = String(definition.rows[0].src);
    assert.match(src, /update public\.set_logs sl\s+set deleted_at = now\(\)/);
    assert.equal(/soft_delete_own_set/.test(src), false);
    const index = await db.query(
      `select indexdef from pg_indexes where indexname = 'set_logs_station_round_set_live_uidx'`,
    );
    assert.match(String(index.rows[0].indexdef), /UNIQUE INDEX set_logs_station_round_set_live_uidx/i);
    assert.match(String(index.rows[0].indexdef), /deleted_at IS NULL/i);

    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);

    const local = gym([
      setRow("set-old", "2026-10-01T18:00:00.000Z"),
      setRow("set-new", "2026-10-02T18:00:00.000Z"),
    ]);
    const duplicate = toSyncPayload(local, []);
    assert.equal(duplicate.sets.length, 2);

    let caught = null;
    try {
      await db.query(`select public.sync_apply($1::jsonb)`, [JSON.stringify(duplicate)]);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, "two live rows of the same slot must raise 23505");
    const message = caught instanceof Error ? caught.message : String(caught);
    const code = caught && typeof caught === "object" && "code" in caught ? String(caught.code) : "";
    assert.match(`${code}\n${message}`, /23505|set_logs_station_round_set_live_uidx/);
    await db.exec("rollback").catch(() => {});

    const leftover = await db.query(`select id from public.set_logs`);
    assert.deepEqual(leftover.rows, []);

    const prepared = prepareSyncSnapshot(local, null, [], { preferLocal: true });
    assert.deepEqual(
      prepared.snapshot.sets.map((row) => row.id),
      ["set-new"],
    );
    assert.deepEqual(prepared.tombstones, []);
    assert.equal(prepared.keepsHistory, true);
    const payload = toSyncPayload(prepared.snapshot, prepared.tombstones);
    assert.equal(payload.sets.length, 1);
    assert.equal(payload.sets[0].id, "set-new");
    assert.deepEqual(payload.tombstones, []);

    const applied = await db.query(`select public.sync_apply($1::jsonb) as body`, [JSON.stringify(payload)]);
    const body = applied.rows[0].body;
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    assert.equal(parsed.ok, true);

    const live = await db.query(
      `select id from public.set_logs where deleted_at is null order by id`,
    );
    assert.deepEqual(
      live.rows.map((row) => row.id),
      ["set-new"],
    );
    await db.close();
  });
});
