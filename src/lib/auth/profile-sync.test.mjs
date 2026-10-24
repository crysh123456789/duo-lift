import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  new URL("../../../supabase/migrations/0014_profile_weight_height.sql", import.meta.url),
  "utf8",
);
const sync = sql.slice(sql.indexOf("function public.sync_apply"));
const userWrite = sql.slice(
  sql.indexOf("function public.apply_synced_user"),
  sql.indexOf("function public.sync_apply"),
);
const headers = sql.match(/create or replace function[\s\S]*?\bas\b/g) ?? [];
const root = fileURLToPath(new URL("../../..", import.meta.url));

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
    assert.match(userWrite, /src\.profile_updated_at > dest\.profile_updated_at/);
    assert.match(userWrite, /when dest\.height_cm is not null then dest\.height_cm/);
    assert.match(userWrite, /when dest\.weight_kg is not null then dest\.weight_kg/);
    assert.match(userWrite, /user_row \? 'height_cm'/);
    assert.match(userWrite, /user_row \? 'weight_kg'/);
    assert.equal(/height_cm = src\.height_cm/.test(userWrite), false);
    assert.equal(/weight_kg = src\.weight_kg,/.test(userWrite), false);
    assert.equal(/when src\.height_cm is null then null/.test(userWrite), false);
    assert.equal(/when src\.weight_kg is null then null/.test(userWrite), false);
  });

  test("rejects profile_updated_at more than 5 minutes in the future before any write", () => {
    assert.match(userWrite, /profile_at > now\(\) \+ interval '5 minutes'/);
    assert.match(userWrite, /raise exception 'profile_updated_at is more than 5 minutes in the future'/);
    assert.match(userWrite, /raise exception 'profile_updated_at must be a timestamp'/);
    const check = userWrite.indexOf("profile_at > now() + interval '5 minutes'");
    const write = userWrite.indexOf("update public.users as dest");
    assert.equal(check >= 0 && write > check, true);
  });

  test("rejects height_cm outside 50..272, extra decimals, and non-numeric values", () => {
    assert.match(userWrite, /raise exception 'height_cm must be numeric' using errcode = '22023'/);
    assert.match(userWrite, /height_text ~\* 'nan\|infinity\|inf'/);
    assert.match(userWrite, /height_num = 'NaN'::numeric/);
    assert.match(userWrite, /height_num < 0/);
    assert.match(userWrite, /raise exception 'height_cm out of range' using errcode = '22023'/);
    assert.match(userWrite, /height_num <> round\(height_num, 1\)/);
    assert.match(
      userWrite,
      /raise exception 'height_cm must have at most 1 decimal' using errcode = '22023'/,
    );
    assert.match(userWrite, /height_num < 50 or height_num > 272/);
    const check = userWrite.indexOf("raise exception 'height_cm out of range'");
    const write = userWrite.indexOf("update public.users as dest");
    assert.equal(check >= 0 && write > check, true);
    const called = sync.indexOf("perform public.apply_synced_user(payload)");
    const food = sync.indexOf("insert into public.food_days");
    assert.equal(called >= 0 && food > called, true);
  });

  test("adds NOT VALID checks and then validates them", () => {
    for (const name of [
      "users_weight_kg_range",
      "users_height_cm_range",
      "users_protein_target_g_range",
      "users_kcal_target_range",
    ]) {
      const add = sql.indexOf(`add constraint ${name}`);
      const valid = sql.indexOf(`validate constraint ${name}`);
      assert.equal(add >= 0 && valid > add, true, name);
      const clause = sql.slice(add, sql.indexOf("not valid", add) + "not valid".length);
      assert.match(clause, /not valid/i);
    }
    assert.match(sql, /weight_kg >= 20/);
    assert.match(sql, /weight_kg <= 400/);
    assert.match(sql, /height_cm >= 50/);
    assert.match(sql, /height_cm <= 272/);
    assert.match(sql, /protein_target_g >= 0 and protein_target_g <= 500/);
    assert.match(sql, /kcal_target >= 0 and kcal_target <= 10000/);
  });

  test("sync_apply stays security invoker and the new user writer is the only definer", () => {
    assert.match(sync, /security invoker/);
    assert.match(sync, /set search_path = public/);
    assert.match(userWrite, /security definer/);
    assert.match(userWrite, /set search_path = ''/);
    assert.equal(headers.length >= 4, true);
    for (const header of headers) {
      if (header.includes("function public.apply_synced_user")) continue;
      assert.equal(/security definer/i.test(header), false, header.slice(0, 120));
    }
    assert.equal(/disable row level security/i.test(sql), false);
    assert.equal(/food_days_history_capture/.test(sql), false);
    assert.equal(/function private\.handle_new_user/.test(sql), false);
    assert.match(sync, /revoke all on function public\.sync_apply\(jsonb\) from service_role/);
    assert.match(sync, /grant execute on function public\.sync_apply\(jsonb\) to authenticated/);
  });

  test("authenticated cannot PATCH public.users; profile writes go through sync_apply", () => {
    assert.match(sql, /drop policy if exists users_update_own on public\.users/);
    assert.match(sql, /revoke update on table public\.users from public/);
    assert.match(sql, /revoke update on table public\.users from anon/);
    assert.match(sql, /revoke update on table public\.users from authenticated/);
    assert.match(sql, /grant select on table public\.users to authenticated/);
    assert.equal(/grant update \(/.test(sql), false);
    assert.equal(/grant update on (table )?public\.users to authenticated/.test(sql), false);
    assert.equal(/create trigger[\s\S]*before update on public\.users/i.test(sql), false);
    const signup = readFileSync(path.join(root, "src/app/signup/page.tsx"), "utf8");
    assert.equal(/\.from\(["']users["']\)/.test(signup), false);
    assert.equal(/\.update\(/.test(signup), false);
    assert.equal(existsSync(path.join(root, "src/lib/supabase/admin.ts")), false);

    function walk(dir, acc = []) {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next" || name === ".git") continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full, acc);
        else if (/\.(ts|tsx|mjs|js)$/.test(name)) acc.push(full);
      }
      return acc;
    }
    const hits = [];
    for (const file of walk(path.join(root, "src"))) {
      if (file.endsWith("profile-sync.test.mjs")) continue;
      const text = readFileSync(file, "utf8");
      if (text.includes("supabase/admin") || text.includes("createAdminClient")) {
        hits.push(path.relative(root, file));
      }
      if (/\.from\(["']users["']\)[\s\S]{0,80}\.update\(/.test(text)) hits.push(path.relative(root, file));
    }
    assert.deepEqual(hits, []);
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
