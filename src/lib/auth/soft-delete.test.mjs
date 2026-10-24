import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const sql = readFileSync(new URL("../../../supabase/migrations/0008_soft_delete.sql", import.meta.url), "utf8");
const previous = readFileSync(
  new URL("../../../supabase/migrations/0007_auth_per_person.sql", import.meta.url),
  "utf8",
);

const tables = [
  "workouts",
  "workout_blocks",
  "block_stations",
  "set_logs",
  "reactions",
  "food_days",
  "working_loads",
  "exercise_catalog",
];

describe("soft-delete migration", () => {
  test("0007 still hard-deletes and this migration does not edit that behavior in place", () => {
    assert.match(previous, /delete from public\.workouts w/);
    assert.equal(/delete from public\./i.test(sql), false);
  });

  test("adds deleted_at and keeps live uniqueness partial", () => {
    for (const table of tables) {
      assert.match(sql, new RegExp(`alter table public\\.${table} add column if not exists deleted_at timestamptz`));
    }
    assert.match(
      sql,
      /create unique index if not exists set_logs_station_round_set_live_uidx[\s\S]*where deleted_at is null/,
    );
    assert.match(
      sql,
      /create unique index if not exists food_days_user_date_live_uidx[\s\S]*where deleted_at is null/,
    );
  });

  test("sync_apply soft-deletes, restores on upsert, and refuses demo ids", () => {
    const fnStart = sql.indexOf("create or replace function public.sync_apply");
    const fn = sql.slice(fnStart);
    assert.match(fn, /set deleted_at = now\(\)/);
    assert.match(fn, /deleted_at = null/);
    const guard = fn.indexOf("if rec.entity_id like 'w-cr-%' or rec.entity_id like 'w-am-%' then");
    const tombstone = fn.indexOf("insert into public.user_tombstones");
    assert.equal(guard >= 0, true);
    assert.equal(tombstone > guard, true);
    assert.match(fn, /continue;/);
    assert.match(fn, /sl\.id not like 'w-cr-%'/);
    assert.match(fn, /sl\.id not like 'w-am-%'/);
  });

  test("select policies hide soft-deleted rows and hard delete is revoked", () => {
    const selects = [...sql.matchAll(/create policy (\w+)[\s\S]*?for select to authenticated[\s\S]*?;/g)].map(
      (match) => match[0],
    );
    assert.equal(selects.length >= tables.length, true);
    for (const policy of selects) {
      assert.match(policy, /deleted_at is null/);
      assert.equal(/user_metadata|jwt_duo_id/.test(policy), false);
    }
    assert.match(sql, /revoke delete on table/);
    assert.equal(/for delete to authenticated/.test(sql), false);
  });

  test("0009 adds manual targets without editing 0007 or 0008", () => {
    const targets = readFileSync(
      new URL("../../../supabase/migrations/0009_nutrition_targets.sql", import.meta.url),
      "utf8",
    );
    assert.equal(/protein_target_g/.test(sql), false);
    assert.equal(/protein_target_g/.test(previous), false);
    assert.equal(/kcal_target/.test(sql), false);
    assert.match(targets, /add column if not exists protein_target_g integer/);
    assert.match(targets, /add column if not exists kcal_target integer/);
    assert.match(targets, /when src.protein_target_g is null then null/);
    assert.match(targets, /src.protein_target_g between 1 and 1000/);
    assert.match(targets, /src.kcal_target between 1 and 20000/);
    assert.equal(/insert into public\.users/i.test(targets), false);
    assert.equal(/delete from public\./i.test(targets), false);
    assert.equal((targets.match(/create or replace function public\.sync_apply/g) ?? []).length, 1);
    const guard = targets.indexOf("if rec.entity_id like 'w-cr-%' or rec.entity_id like 'w-am-%' then");
    const tombstone = targets.indexOf("insert into public.user_tombstones");
    assert.equal(guard >= 0 && tombstone > guard, true);
  });

  test("0010 merges food days, soft-deletes the duplicate, and keeps history", () => {
    const food = readFileSync(
      new URL("../../../supabase/migrations/0010_food_day_merge.sql", import.meta.url),
      "utf8",
    );
    assert.match(previous, /delete from public\.food_days legacy/);
    assert.match(previous, /delete from public\.food_days existing/);
    assert.equal(/delete from public\.food_days/i.test(food), false);
    assert.match(food, /create table if not exists public\.food_days_history/);
    assert.match(food, /before update or delete on public\.food_days/);
    assert.match(food, /food_days_history_capture/);
    assert.match(food, /public\.merge_food_meals/);
    assert.match(food, /public\.resolve_food_day/);
    assert.match(food, /set deleted_at = now\(\)/);
    const claim = food.slice(food.indexOf("function private.claim_legacy_history"));
    assert.match(claim, /for pair in/);
    assert.match(claim, /public\.merge_food_meals\(pair\.legacy_meals, pair\.dest_meals\)/);
    assert.match(claim, /public\.merge_food_meals\(pair\.dest_meals, pair\.legacy_meals\)/);
    assert.equal(/delete from public\.food_days/i.test(claim), false);
    assert.equal((food.match(/create or replace function public\.sync_apply/g) ?? []).length, 1);
    assert.equal(/protein_target_g/.test(previous), false);
  });
});
