import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sql15 = readFileSync(new URL("../../../supabase/migrations/0015_set_logs_owner_rls.sql", import.meta.url), "utf8");
const sql16 = readFileSync(new URL("../../../supabase/migrations/0016_set_logs_soft_delete_rpc.sql", import.meta.url), "utf8");
const sql17 = readFileSync(new URL("../../../supabase/migrations/0017_tolerant_sync_apply.sql", import.meta.url), "utf8");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("tolerant sync_apply", () => {
  test("stays security invoker and the soft-delete RPCs do not take an owner argument", () => {
    const sync = sql17.slice(sql17.indexOf("create or replace function public.sync_apply"));
    assert.match(sync, /security invoker/);
    assert.match(sync, /set search_path = public/);
    assert.equal(/security definer/.test(sync), false);
    assert.match(sync, /'items', coalesce\(item_results, '\[\]'::jsonb\)/);
    assert.match(sync, /revoke all on function public\.sync_apply\(jsonb\) from service_role/);
    assert.match(sync, /grant execute on function public\.sync_apply\(jsonb\) to authenticated/);
    assert.equal(/grant execute on function public\.sync_apply\(jsonb\) to anon/.test(sql17), false);

    for (const name of [
      "soft_delete_own_reaction",
      "soft_delete_own_workout",
      "soft_delete_own_block",
      "soft_delete_own_station",
      "soft_delete_own_food_day",
      "soft_delete_own_exercise",
      "soft_delete_own_load",
    ]) {
      const start = sql17.indexOf(`function public.${name}`);
      assert.equal(start >= 0, true, name);
      const fn = sql17.slice(start, sql17.indexOf(`revoke all on function public.${name}`));
      assert.match(fn, /security definer/);
      assert.match(fn, /set search_path = ''/);
      assert.match(fn, /\(select auth\.uid\(\)\)::text/);
      assert.equal(/p_user|p_owner/.test(fn), false, name);
      assert.match(sql17, new RegExp(`revoke execute on function public\\.${name}\\(text\\) from public, anon`));
      assert.match(sql17, new RegExp(`grant execute on function public\\.${name}\\(text\\) to authenticated`));
      assert.equal(new RegExp(`grant execute on function public\\.${name}\\(text\\) to anon`).test(sql17), false);
    }
    assert.match(sync, /public\.soft_delete_own_reaction\(rec\.entity_id\)/);
    assert.match(sync, /public\.soft_delete_own_workout\(rec\.entity_id\)/);
    assert.equal(/update public\.reactions r\s+set deleted_at = now\(\)/.test(sync), false);
    assert.equal(/update public\.workouts w\s+set deleted_at = now\(\)/.test(sync), false);
  });

  test("a stale tombstoned set does not abort the batch and is not revived", async () => {
    const db = await setup();
    await asUser(db, OWNER);
    const deleted = await db.query(
      `select public.sync_apply('{"tombstones":[{"entity":"sets","id":"set-dead"}]}'::jsonb) as body`,
    );
    assert.equal(bodyOf(deleted).ok, true);

    const resent = await db.query(`select public.sync_apply($1::jsonb) as body`, [
      JSON.stringify({
        sets: [
          row("set-dead", "st-owner", 1, 2, 99),
          row("set-owner", "st-owner", 1, 1, 6),
        ],
      }),
    ]);
    const body = bodyOf(resent);
    assert.equal(body.ok, true);
    assert.deepEqual(statuses(body, "sets"), [{ id: "set-dead", status: "obsolete" }]);

    await asAdmin(db);
    const sets = await db.query(
      `select id, reps, deleted_at is null as live from public.set_logs order by id`,
    );
    assert.deepEqual(
      sets.rows.map((row) => ({ id: row.id, reps: Number(row.reps), live: row.live })),
      [
        { id: "set-dead", reps: 8, live: false },
        { id: "set-other", reps: 10, live: true },
        { id: "set-owner", reps: 6, live: true },
      ],
    );
    await db.close();
  });

  test("a foreign row is rejected and the caller's other sets still apply", async () => {
    const db = await setup();
    await asUser(db, OWNER);
    const applied = await db.query(`select public.sync_apply($1::jsonb) as body`, [
      JSON.stringify({
        sets: [
          row("set-owner", "st-owner", 1, 1, 7),
          row("set-other", "st-owner", 1, 9, 1),
          row("set-new", "st-owner", 1, 3, 5),
        ],
      }),
    ]);
    const body = bodyOf(applied);
    assert.equal(body.ok, true);
    assert.deepEqual(statuses(body, "sets"), [{ id: "set-other", status: "rejected" }]);

    await asAdmin(db);
    const sets = await db.query(
      `select id, user_id, reps, station_id, deleted_at is null as live from public.set_logs order by id`,
    );
    assert.deepEqual(
      sets.rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        reps: Number(row.reps),
        station_id: row.station_id,
        live: row.live,
      })),
      [
        { id: "set-dead", user_id: OWNER, reps: 8, station_id: "st-owner", live: true },
        { id: "set-new", user_id: OWNER, reps: 5, station_id: "st-owner", live: true },
        { id: "set-other", user_id: OTHER, reps: 10, station_id: "st-other", live: true },
        { id: "set-owner", user_id: OWNER, reps: 7, station_id: "st-owner", live: true },
      ],
    );
    await db.close();
  });

  test("reactions and workouts soft-delete for the owner, and not for another user or anon", async () => {
    const db = await setup();
    await asAdmin(db);
    await db.exec(deletePolicies);
    await db.exec(`
      insert into public.reactions (id, workout_id, from_user_id, kind) values
        ('rx-owner', 'w-owner', '${OWNER}', 'fire'),
        ('rx-other', 'w-other', '${OTHER}', 'fire');
      insert into public.food_days (id, user_id, date) values
        ('food-owner', '${OWNER}', '2026-10-25'),
        ('food-other', '${OTHER}', '2026-10-25');
      insert into public.exercise_catalog (id, name, created_by_user_id) values
        ('ex-owner', 'Banca', '${OWNER}'),
        ('ex-other', 'Peso', '${OTHER}');
      insert into public.working_loads (user_id, exercise_id, weight_kg, reps) values
        ('${OWNER}', 'ex-owner', 40, 8),
        ('${OTHER}', 'ex-other', 50, 8);
    `);

    await asUser(db, OWNER);
    await expectError(db, /42501|row-level security/i, () =>
      db.query(`update public.reactions set deleted_at = now() where id = 'rx-owner'`),
    );
    await expectError(db, /42501|row-level security/i, () =>
      db.query(`update public.workouts set deleted_at = now() where id = 'w-owner'`),
    );
    await expectError(db, /42501|row-level security/i, () =>
      db.query(`update public.workout_blocks set deleted_at = now() where id = 'b-owner'`),
    );

    await asAnon(db);
    for (const name of [
      "soft_delete_own_reaction",
      "soft_delete_own_workout",
      "soft_delete_own_block",
      "soft_delete_own_station",
      "soft_delete_own_food_day",
      "soft_delete_own_exercise",
      "soft_delete_own_load",
    ]) {
      await expectError(db, /permission denied/i, () => db.query(`select public.${name}('x')`));
    }
    await expectError(db, /permission denied/i, () =>
      db.query(`select public.sync_apply('{"tombstones":[{"entity":"workouts","id":"w-owner"}]}'::jsonb)`),
    );

    await asUser(db, OTHER);
    assert.equal((await db.query(`select public.soft_delete_own_reaction('rx-owner') as ok`)).rows[0].ok, false);
    assert.equal((await db.query(`select public.soft_delete_own_workout('w-owner') as ok`)).rows[0].ok, false);
    assert.equal((await db.query(`select public.soft_delete_own_block('b-owner') as ok`)).rows[0].ok, false);
    assert.equal((await db.query(`select public.soft_delete_own_station('st-owner') as ok`)).rows[0].ok, false);
    assert.equal((await db.query(`select public.soft_delete_own_food_day('food-owner') as ok`)).rows[0].ok, false);
    assert.equal((await db.query(`select public.soft_delete_own_exercise('ex-owner') as ok`)).rows[0].ok, false);
    assert.equal(
      (await db.query(`select public.soft_delete_own_load('${OWNER}:ex-owner') as ok`)).rows[0].ok,
      false,
    );
    const otherSync = bodyOf(
      await db.query(
        `select public.sync_apply('{"tombstones":[{"entity":"reactions","id":"rx-owner"},{"entity":"workouts","id":"w-owner"}]}'::jsonb) as body`,
      ),
    );
    assert.equal(otherSync.ok, true);

    await asAdmin(db);
    const still = await liveMap(db);
    assert.equal(still.reactions["rx-owner"], true);
    assert.equal(still.workouts["w-owner"], true);

    await asUser(db, OWNER);
    assert.equal((await db.query(`select public.soft_delete_own_reaction('rx-owner') as ok`)).rows[0].ok, true);
    const owned = bodyOf(
      await db.query(
        `select public.sync_apply($1::jsonb) as body`,
        [
          JSON.stringify({
            tombstones: [
              { entity: "workouts", id: "w-owner" },
              { entity: "blocks", id: "b-other" },
              { entity: "stations", id: "st-owner" },
              { entity: "foodDays", id: "food-owner" },
              { entity: "exercises", id: "ex-owner" },
              { entity: "workingLoads", id: `${OWNER}:ex-owner` },
            ],
          }),
        ],
      ),
    );
    assert.equal(owned.ok, true);

    await asAdmin(db);
    const after = await liveMap(db);
    assert.equal(after.reactions["rx-owner"], false);
    assert.equal(after.reactions["rx-other"], true);
    assert.equal(after.workouts["w-owner"], false);
    assert.equal(after.workouts["w-other"], true);
    assert.equal(after.blocks["b-owner"], true);
    assert.equal(after.blocks["b-other"], true);
    assert.equal(after.stations["st-owner"], false);
    assert.equal(after.stations["st-other"], true);
    assert.equal(after.food["food-owner"], false);
    assert.equal(after.food["food-other"], true);
    assert.equal(after.exercises["ex-owner"], false);
    assert.equal(after.exercises["ex-other"], true);
    assert.equal(after.loads[`${OWNER}:ex-owner`], false);
    assert.equal(after.loads[`${OTHER}:ex-other`], true);
    await db.close();
  });
});

function row(id, stationId, roundIndex, setIndex, reps) {
  return {
    id,
    station_id: stationId,
    round_index: roundIndex,
    set_index: setIndex,
    reps,
    weight_kg: 40,
    logged_at: "2026-10-25T12:00:00.000Z",
  };
}

function bodyOf(result) {
  const body = result.rows[0].body;
  return typeof body === "string" ? JSON.parse(body) : body;
}

function statuses(body, entity) {
  return (body.items ?? [])
    .filter((row) => row.entity === entity)
    .map((row) => ({ id: row.id, status: row.status }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function liveMap(db) {
  const reactions = await db.query(`select id, deleted_at is null as live from public.reactions order by id`);
  const workouts = await db.query(`select id, deleted_at is null as live from public.workouts order by id`);
  const blocks = await db.query(`select id, deleted_at is null as live from public.workout_blocks order by id`);
  const stations = await db.query(`select id, deleted_at is null as live from public.block_stations order by id`);
  const food = await db.query(`select id, deleted_at is null as live from public.food_days order by id`);
  const exercises = await db.query(`select id, deleted_at is null as live from public.exercise_catalog order by id`);
  const loads = await db.query(
    `select user_id || ':' || exercise_id as id, deleted_at is null as live from public.working_loads order by 1`,
  );
  const map = (result) => Object.fromEntries(result.rows.map((row) => [row.id, row.live]));
  return {
    reactions: map(reactions),
    workouts: map(workouts),
    blocks: map(blocks),
    stations: map(stations),
    food: map(food),
    exercises: map(exercises),
    loads: map(loads),
  };
}

const deletePolicies = `
  alter table public.workouts enable row level security;
  alter table public.workouts force row level security;
  alter table public.workout_blocks enable row level security;
  alter table public.workout_blocks force row level security;
  alter table public.block_stations enable row level security;
  alter table public.block_stations force row level security;
  alter table public.reactions enable row level security;
  alter table public.reactions force row level security;
  alter table public.food_days enable row level security;
  alter table public.food_days force row level security;
  alter table public.exercise_catalog enable row level security;
  alter table public.exercise_catalog force row level security;
  alter table public.working_loads enable row level security;
  alter table public.working_loads force row level security;

  create policy workouts_select_own on public.workouts for select to authenticated
    using (user_id = (select auth.uid())::text and deleted_at is null);
  create policy workouts_update_own on public.workouts for update to authenticated
    using (user_id = (select auth.uid())::text)
    with check (user_id = (select auth.uid())::text);

  create policy blocks_select_own on public.workout_blocks for select to authenticated
    using (
      workout_blocks.deleted_at is null
      and exists (
        select 1 from public.workouts w
        where w.id = workout_blocks.workout_id
          and w.user_id = (select auth.uid())::text
          and w.deleted_at is null
      )
    );
  create policy blocks_update_own on public.workout_blocks for update to authenticated
    using (exists (
      select 1 from public.workouts w
      where w.id = workout_blocks.workout_id and w.user_id = (select auth.uid())::text
    ))
    with check (exists (
      select 1 from public.workouts w
      where w.id = workout_blocks.workout_id and w.user_id = (select auth.uid())::text
    ));

  create policy stations_select_own on public.block_stations for select to authenticated
    using (
      block_stations.deleted_at is null
      and exists (
        select 1 from public.workout_blocks b
        join public.workouts w on w.id = b.workout_id
        where b.id = block_stations.block_id
          and w.user_id = (select auth.uid())::text
          and w.deleted_at is null
      )
    );
  create policy stations_update_own on public.block_stations for update to authenticated
    using (exists (
      select 1 from public.workout_blocks b
      join public.workouts w on w.id = b.workout_id
      where b.id = block_stations.block_id and w.user_id = (select auth.uid())::text
    ))
    with check (exists (
      select 1 from public.workout_blocks b
      join public.workouts w on w.id = b.workout_id
      where b.id = block_stations.block_id and w.user_id = (select auth.uid())::text
    ));

  create policy reactions_select_own on public.reactions for select to authenticated
    using (
      reactions.deleted_at is null
      and exists (
        select 1 from public.workouts w
        where w.id = reactions.workout_id
          and w.user_id = (select auth.uid())::text
          and w.deleted_at is null
      )
    );
  create policy reactions_update_own on public.reactions for update to authenticated
    using (
      from_user_id = (select auth.uid())::text
      and exists (
        select 1 from public.workouts w
        where w.id = reactions.workout_id and w.user_id = (select auth.uid())::text
      )
    )
    with check (
      from_user_id = (select auth.uid())::text
      and exists (
        select 1 from public.workouts w
        where w.id = reactions.workout_id and w.user_id = (select auth.uid())::text
      )
    );

  create policy food_days_select_own on public.food_days for select to authenticated
    using (user_id = (select auth.uid())::text and deleted_at is null);
  create policy food_days_update_own on public.food_days for update to authenticated
    using (user_id = (select auth.uid())::text)
    with check (user_id = (select auth.uid())::text);

  create policy exercises_select_visible on public.exercise_catalog for select to authenticated
    using (deleted_at is null and (created_by_user_id is null or created_by_user_id = (select auth.uid())::text));
  create policy exercises_update_own on public.exercise_catalog for update to authenticated
    using (created_by_user_id = (select auth.uid())::text)
    with check (created_by_user_id = (select auth.uid())::text);

  create policy working_loads_select_own on public.working_loads for select to authenticated
    using (user_id = (select auth.uid())::text and deleted_at is null);
  create policy working_loads_update_own on public.working_loads for update to authenticated
    using (user_id = (select auth.uid())::text)
    with check (user_id = (select auth.uid())::text);
`;

async function setup() {
  const db = new PGlite();
  await db.exec(fixtureSql());
  await db.exec(sql15);
  await db.exec(`
    create or replace function public.apply_synced_user(payload jsonb)
    returns void language plpgsql as $$ begin return; end $$;
    grant execute on function public.apply_synced_user(jsonb) to authenticated;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    grant select, insert, update on
      public.exercise_catalog,
      public.workouts,
      public.workout_blocks,
      public.block_stations,
      public.reactions,
      public.food_days,
      public.working_loads,
      public.user_reminders,
      public.user_tombstones
    to authenticated;
    grant select on public.workouts, public.workout_blocks, public.block_stations to authenticated;
  `);
  await db.exec(sql16);
  await db.exec(sql17);
  return db;
}

function fixtureSql() {
  return `
    create schema if not exists auth;
    create or replace function auth.uid()
    returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create table public.users (
      id text primary key,
      email text not null unique,
      display_name text not null
    );
    create table public.workouts (
      id text primary key,
      user_id text not null references public.users (id),
      duo_id text not null,
      started_at timestamptz not null default now(),
      ended_at timestamptz,
      status text not null default 'completed',
      notes text,
      perceived_exertion smallint,
      title text,
      deleted_at timestamptz
    );
    create table public.workout_blocks (
      id text primary key,
      workout_id text not null references public.workouts (id),
      position integer not null default 1,
      kind text not null default 'straight',
      name text,
      target_rounds integer not null default 1,
      rest_between_rounds_sec integer,
      rest_sec integer,
      deleted_at timestamptz
    );
    create table public.block_stations (
      id text primary key,
      block_id text not null references public.workout_blocks (id),
      exercise_id text not null,
      position integer not null default 1,
      notes text,
      deleted_at timestamptz
    );
    create table public.set_logs (
      id text primary key,
      station_id text not null references public.block_stations (id),
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
    create table public.exercise_catalog (
      id text primary key,
      name text not null,
      muscle_group text,
      equipment text,
      is_unilateral boolean not null default false,
      created_by_user_id text,
      duo_id text,
      deleted_at timestamptz
    );
    create table public.reactions (
      id text primary key,
      workout_id text not null,
      from_user_id text not null,
      kind text not null,
      body text,
      created_at timestamptz not null default now(),
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
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    );
    create table public.working_loads (
      user_id text not null,
      exercise_id text not null,
      weight_kg numeric,
      reps integer,
      reps_right integer,
      updated_at timestamptz not null default now(),
      deleted_at timestamptz,
      primary key (user_id, exercise_id)
    );
    create table public.user_reminders (
      user_id text primary key,
      settings jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
    create table public.user_tombstones (
      user_id text not null,
      entity text not null,
      entity_id text not null,
      deleted_at timestamptz not null default now(),
      primary key (user_id, entity, entity_id)
    );
    insert into public.users (id, email, display_name) values
      ('${OWNER}', 'owner@duo.lift', 'Owner'),
      ('${OTHER}', 'other@duo.lift', 'Other');
    insert into public.workouts (id, user_id, duo_id) values
      ('w-owner', '${OWNER}', 'duo-1'),
      ('w-other', '${OTHER}', 'duo-1');
    insert into public.workout_blocks (id, workout_id) values
      ('b-owner', 'w-owner'),
      ('b-other', 'w-other');
    insert into public.block_stations (id, block_id, exercise_id) values
      ('st-owner', 'b-owner', 'ex-banca'),
      ('st-other', 'b-other', 'ex-banca');
    insert into public.set_logs (id, station_id, round_index, set_index, reps, weight_kg) values
      ('set-owner', 'st-owner', 1, 1, 8, 40),
      ('set-dead', 'st-owner', 1, 2, 8, 40),
      ('set-other', 'st-other', 1, 1, 10, 50);
  `;
}

async function asAdmin(db) {
  await db.exec("reset role");
}

async function asUser(db, id) {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
  await db.exec("set role authenticated");
}

async function asAnon(db) {
  await db.exec("reset role");
  await db.exec("set role anon");
}

async function expectError(db, pattern, run) {
  let caught = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected the statement to fail");
  const message = caught instanceof Error ? caught.message : String(caught);
  assert.match(message, pattern);
  await db.exec("rollback").catch(() => {});
}
