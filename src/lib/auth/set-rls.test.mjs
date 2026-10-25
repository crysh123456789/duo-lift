import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync(new URL("../../../supabase/migrations/0015_set_logs_owner_rls.sql", import.meta.url), "utf8");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function policy(name) {
  const start = sql.indexOf(`create policy ${name}`);
  assert.equal(start >= 0, true, name);
  const end = sql.indexOf(";", start);
  return sql.slice(start, end + 1);
}

describe("set_logs owner policies", () => {
  test("update has WITH CHECK on auth.uid and delete is owner-only", () => {
    const update = policy("sets_update_own");
    const del = policy("sets_delete_own");
    assert.match(update, /for update to authenticated/);
    assert.match(del, /for delete to authenticated/);
    const using = update.slice(update.indexOf("using"), update.indexOf("with check"));
    const check = update.slice(update.indexOf("with check"));
    assert.match(using, /set_logs\.user_id = \(select auth\.uid\(\)\)::text/);
    assert.match(check, /set_logs\.user_id = \(select auth\.uid\(\)\)::text/);
    assert.match(check, /w\.user_id = set_logs\.user_id/);
    assert.match(del, /set_logs\.user_id = \(select auth\.uid\(\)\)::text/);
    assert.equal(/for (update|delete|select|insert) to (anon|public)/.test(sql), false);
    assert.equal(/user_metadata|jwt_duo_id/.test(sql), false);
    assert.match(sql, /revoke all on table public\.set_logs from public, anon/);
    assert.match(sql, /grant select, insert, update, delete on table public\.set_logs to authenticated/);
    assert.equal(/to anon/.test(sql.slice(sql.indexOf("grant select"))), false);
    assert.match(sql, /new\.user_id is distinct from old\.user_id/);
    assert.match(sql, /raise exception 'user_id_immutable'/);
    assert.match(sql, /alter table public\.set_logs force row level security/);

    const rpc = readFileSync(
      new URL("../../../supabase/migrations/0016_set_logs_soft_delete_rpc.sql", import.meta.url),
      "utf8",
    );
    const fn = rpc.slice(rpc.indexOf("function public.soft_delete_own_set"), rpc.indexOf("revoke all on function public.soft_delete_own_set"));
    assert.match(fn, /security definer/);
    assert.match(fn, /set search_path = ''/);
    assert.match(fn, /function public\.soft_delete_own_set\(p_set_id text\)/);
    assert.match(fn, /\(select auth\.uid\(\)\)::text/);
    assert.equal(/soft_delete_own_set\([^)]*user/.test(fn), false);
    assert.match(rpc, /revoke execute on function public\.soft_delete_own_set\(text\) from public, anon/);
    assert.match(rpc, /grant execute on function public\.soft_delete_own_set\(text\) to authenticated/);
    assert.equal(/grant execute on function public\.soft_delete_own_set\(text\) to anon/.test(rpc), false);
    const setsBranch = rpc.slice(rpc.indexOf("if rec.entity = 'sets'"), rpc.indexOf("elsif rec.entity = 'reactions'"));
    assert.match(setsBranch, /public\.soft_delete_own_set\(rec\.entity_id\)/);
    assert.equal(/set deleted_at = now\(\)/.test(setsBranch), false);
  });

  test("another user and anon cannot update or delete a series", async () => {
    const db = new PGlite();
    await db.exec(`
      create schema if not exists auth;
      create or replace function auth.uid()
      returns uuid
      language sql
      stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;

      create role anon nologin;
      create role authenticated nologin;

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
        deleted_at timestamptz
      );
      create table public.workout_blocks (
        id text primary key,
        workout_id text not null references public.workouts (id),
        position integer not null default 1,
        kind text not null default 'straight',
        deleted_at timestamptz
      );
      create table public.block_stations (
        id text primary key,
        block_id text not null references public.workout_blocks (id),
        exercise_id text not null,
        position integer not null default 1,
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
        ('set-other', 'st-other', 1, 1, 10, 50);
    `);
    await db.exec(sql);
    await db.exec(`
      grant select on public.workouts, public.workout_blocks, public.block_stations to authenticated;
    `);

    const owned = await db.query(`select user_id, reps from public.set_logs where id = 'set-owner'`);
    assert.equal(owned.rows[0].user_id, OWNER);
    assert.equal(Number(owned.rows[0].reps), 8);

    await asUser(db, OWNER);
    const edited = await db.query(`update public.set_logs set reps = 6, weight_kg = 42.5 where id = 'set-owner'`);
    assert.equal(edited.affectedRows, 1);

    await expectError(db, /user_id_immutable/, () =>
      db.query(`update public.set_logs set user_id = '${OTHER}' where id = 'set-owner'`),
    );
    await expectError(db, /user_id_immutable/, () =>
      db.query(`update public.set_logs set station_id = 'st-other' where id = 'set-owner'`),
    );

    await asUser(db, OTHER);
    const stolenUpdate = await db.query(`update public.set_logs set reps = 1 where id = 'set-owner'`);
    assert.equal(stolenUpdate.affectedRows, 0);
    const stolenDelete = await db.query(`delete from public.set_logs where id = 'set-owner'`);
    assert.equal(stolenDelete.affectedRows, 0);
    const ownEdit = await db.query(`update public.set_logs set reps = 9 where id = 'set-other'`);
    assert.equal(ownEdit.affectedRows, 1);

    await asAnon(db);
    await expectError(db, /permission denied/i, () =>
      db.query(`update public.set_logs set reps = 1 where id = 'set-owner'`),
    );
    await expectError(db, /permission denied/i, () => db.query(`delete from public.set_logs where id = 'set-owner'`));

    await asAdmin(db);
    const after = await db.query(
      `select id, user_id, reps, weight_kg, station_id from public.set_logs order by id`,
    );
    assert.deepEqual(
      after.rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        reps: Number(row.reps),
        weight_kg: Number(row.weight_kg),
        station_id: row.station_id,
      })),
      [
        { id: "set-other", user_id: OTHER, reps: 9, weight_kg: 50, station_id: "st-other" },
        { id: "set-owner", user_id: OWNER, reps: 6, weight_kg: 42.5, station_id: "st-owner" },
      ],
    );

    await asUser(db, OWNER);
    const removed = await db.query(`delete from public.set_logs where id = 'set-owner'`);
    assert.equal(removed.affectedRows, 1);
    const missed = await db.query(`delete from public.set_logs where id = 'set-other'`);
    assert.equal(missed.affectedRows, 0);

    await asAdmin(db);
    const left = await db.query(`select id from public.set_logs order by id`);
    assert.deepEqual(
      left.rows.map((row) => row.id),
      ["set-other"],
    );
    await db.close();
  });

  test("sync_apply tombstone soft-deletes only the owner's series", async () => {
    const db = new PGlite();
    const rpc = readFileSync(
      new URL("../../../supabase/migrations/0016_set_logs_soft_delete_rpc.sql", import.meta.url),
      "utf8",
    );
    await db.exec(fixtureSql());
    await db.exec(sql);
    await db.exec(`
      create or replace function public.apply_synced_user(payload jsonb)
      returns void
      language plpgsql
      as $$ begin return; end $$;
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
    await db.exec(rpc);

    await asUser(db, OWNER);
    await expectError(db, /42501|row-level security|permission denied/i, () =>
      db.query(`update public.set_logs set deleted_at = now() where id = 'set-owner'`),
    );

    await asAnon(db);
    await expectError(db, /permission denied/i, () =>
      db.query(`select public.soft_delete_own_set('set-owner')`),
    );
    await expectError(db, /permission denied/i, () =>
      db.query(`select public.sync_apply('{"tombstones":[{"entity":"sets","id":"set-owner"}]}'::jsonb)`),
    );

    await asUser(db, OTHER);
    const otherRpc = await db.query(`select public.soft_delete_own_set('set-owner') as ok`);
    assert.equal(otherRpc.rows[0].ok, false);
    const otherSync = await db.query(
      `select public.sync_apply('{"tombstones":[{"entity":"sets","id":"set-owner"}]}'::jsonb) as body`,
    );
    assert.equal(otherSync.rows[0].body.ok, true);

    await asAdmin(db);
    const stillLive = await db.query(`select id, deleted_at is null as live from public.set_logs order by id`);
    assert.deepEqual(
      stillLive.rows.map((row) => ({ id: row.id, live: row.live })),
      [
        { id: "set-other", live: true },
        { id: "set-owner", live: true },
      ],
    );

    await asUser(db, OWNER);
    const owned = await db.query(
      `select public.sync_apply('{"tombstones":[{"entity":"sets","id":"set-owner"}]}'::jsonb) as body`,
    );
    assert.equal(owned.rows[0].body.ok, true);

    await asAdmin(db);
    const after = await db.query(
      `select id, deleted_at is null as live from public.set_logs order by id`,
    );
    assert.deepEqual(
      after.rows.map((row) => ({ id: row.id, live: row.live })),
      [
        { id: "set-other", live: true },
        { id: "set-owner", live: false },
      ],
    );
    const stones = await db.query(
      `select user_id, entity, entity_id from public.user_tombstones order by entity_id`,
    );
    assert.deepEqual(stones.rows, [{ user_id: OWNER, entity: "sets", entity_id: "set-owner" }]);
    await db.close();
  });
});

function fixtureSql() {
  return `
    create schema if not exists auth;
    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
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
