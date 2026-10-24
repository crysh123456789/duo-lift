import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const sql = readFileSync(
  new URL("../../../supabase/migrations/0014_profile_weight_height.sql", import.meta.url),
  "utf8",
);
const sync = sql.slice(sql.indexOf("function public.sync_apply"));
const headers = sql.match(/create or replace function[\s\S]*?\bas\b/g) ?? [];

describe("profile weight and height", () => {
  test("adds profile_updated_at, keeps numeric(5,1), and backfills a clock", () => {
    assert.match(sql, /add column if not exists profile_updated_at timestamptz/);
    assert.match(
      sql,
      /update public\.users\s+set profile_updated_at = now\(\)\s+where profile_updated_at is null\s+and \(weight_kg is not null or height_cm is not null\)/,
    );
    assert.match(
      sql,
      /alter table public\.users\s+alter column weight_kg type numeric\(5,1\)\s+using round\(weight_kg::numeric, 1\)::numeric\(5,1\)/,
    );
    assert.equal(/alter column weight_kg type integer/.test(sql), false);
  });

  test("a null or absent height or weight does not erase the stored value", () => {
    assert.match(sync, /src\.profile_updated_at > dest\.profile_updated_at/);
    assert.match(sync, /when dest\.height_cm is not null then dest\.height_cm/);
    assert.match(sync, /when dest\.weight_kg is not null then dest\.weight_kg/);
    assert.match(sync, /user_row \? 'height_cm'/);
    assert.match(sync, /user_row \? 'weight_kg'/);
    assert.equal(/height_cm = src\.height_cm/.test(sync), false);
    assert.equal(/weight_kg = src\.weight_kg,/.test(sync), false);
    assert.equal(/when src\.height_cm is null then null/.test(sync), false);
    assert.equal(/when src\.weight_kg is null then null/.test(sync), false);
  });

  test("rejects profile_updated_at more than 5 minutes in the future before any write", () => {
    assert.match(sync, /profile_at > now\(\) \+ interval '5 minutes'/);
    assert.match(sync, /raise exception 'profile_updated_at is more than 5 minutes in the future'/);
    assert.match(sync, /raise exception 'profile_updated_at must be a timestamp'/);
    const check = sync.indexOf("profile_at > now() + interval '5 minutes'");
    const write = sync.indexOf("update public.users as dest");
    assert.equal(check >= 0 && write > check, true);
  });

  test("sync_apply stays security invoker and does not replace definer functions or RLS", () => {
    assert.match(sync, /security invoker/);
    assert.match(sync, /set search_path = public/);
    assert.equal(headers.length >= 3, true);
    for (const header of headers) {
      assert.equal(/security definer/i.test(header), false, header.slice(0, 80));
    }
    assert.equal(/disable row level security/i.test(sql), false);
    assert.equal(/food_days_history_capture/.test(sql), false);
    assert.match(sync, /revoke all on function public\.sync_apply\(jsonb\) from service_role/);
    assert.match(sync, /grant execute on function public\.sync_apply\(jsonb\) to authenticated/);
  });
});

describe("cleared meals", () => {
  test("an explicit clear stores the empty items array", () => {
    const slot = sql.slice(sql.indexOf("function public.merge_meal_slot"));
    assert.match(slot, /newer -> 'cleared' = 'true'::jsonb or newer ->> 'cleared' = 'true'/);
    assert.match(slot, /'items', case/);
    assert.match(slot, /'cleared', true/);
    assert.match(slot, /public\.meal_slot_empty\(new_slot\)/);
  });

  test("mealItems tombstones strip the item after the meal merge and are always recorded", () => {
    const strip = sql.slice(sql.indexOf("function public.strip_meal_item"));
    assert.match(strip, /security invoker/);
    assert.match(strip, /set search_path = ''/);
    assert.match(sync, /'mealItems'/);
    assert.match(sync, /elsif rec\.entity = 'mealItems'/);
    assert.match(sync, /public\.strip_meal_item\(fd\.meals, rec\.entity_id\)/);
    const merge = sync.indexOf("public.merge_food_meals");
    const branch = sync.indexOf("elsif rec.entity = 'mealItems'");
    assert.equal(merge >= 0 && branch > merge, true);
    assert.match(sync, /if v_deleted > 0 or rec\.entity = 'mealItems'/);
    assert.match(sql, /grant execute on function public\.strip_meal_item\(jsonb, text\) to authenticated/);
    assert.match(sql, /revoke all on function public\.strip_meal_item\(jsonb, text\) from public, anon/);
  });
});
