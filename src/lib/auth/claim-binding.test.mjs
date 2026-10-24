import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const sql = readFileSync(
  new URL("../../../supabase/migrations/0013_drop_legacy_claim.sql", import.meta.url),
  "utf8",
);
const previous = readFileSync(
  new URL("../../../supabase/migrations/0012_legacy_claim_binding.sql", import.meta.url),
  "utf8",
);
const sync = sql.slice(sql.indexOf("function public.sync_apply"));

describe("legacy claim removal", () => {
  test("does not edit 0012 and does not recreate claim_legacy_history", () => {
    assert.match(previous, /create function private\.claim_legacy_history\(p_key text, p_code text default null\)/);
    assert.match(previous, /create function public\.claim_legacy_history\(p_key text, p_code text default null\)/);
    assert.equal(/create (or replace )?function (public|private)\.claim_legacy_history/.test(sql), false);
    assert.equal(/insert into private\.legacy_claims/i.test(sql), false);
  });

  test("revokes and drops every claim_legacy_history overload in public and private", () => {
    assert.match(sql, /n\.nspname in \('public', 'private'\)/);
    assert.match(sql, /p\.proname = 'claim_legacy_history'/);
    assert.match(sql, /revoke all on function %s from public, anon, authenticated, service_role/);
    assert.match(sql, /drop function %s/);
  });

  test("empties legacy_claims and revokes it because decline and status still read it", () => {
    assert.match(sql, /revoke all on table private\.legacy_claims from public, anon, authenticated, service_role/);
    assert.match(sql, /delete from private\.legacy_claims/);
    assert.match(sql, /decline_legacy_history/);
    assert.match(sql, /legacy_history_status/);
    assert.equal(/drop table (if exists )?private\.legacy_claims/i.test(sql), false);
    assert.match(sql, /drop trigger if exists legacy_claims_normalize_trg on private\.legacy_claims/);
    assert.match(sql, /drop function if exists private\.legacy_claims_normalize\(\)/);
    assert.equal(/drop function if exists private\.optional_numeric/.test(sql), false);
    assert.equal(/drop function extensions\.crypt/.test(sql), false);
  });
});

describe("sync_apply nutrition limits", () => {
  test("keeps food_days limits, rejected.food_days, and security invoker", () => {
    assert.match(sync, /security invoker/);
    assert.match(sync, /set search_path = public/);
    assert.match(sync, /raise exception 'food_days must be an array'/);
    assert.match(sync, /jsonb_array_length\(coalesce\(payload->'food_days', '\[\]'::jsonb\)\) > 5000/);
    assert.match(sync, /raise exception 'too many food_days'/);
    assert.match(sync, /octet_length\(coalesce\(payload->'food_days', '\[\]'::jsonb\)::text\) > 16777216/);
    assert.match(sync, /raise exception 'food_days payload too large'/);
    assert.match(sync, /'other_user'/);
    assert.match(sync, /'foreign_id'/);
    assert.match(sync, /'rejected', jsonb_build_object\('food_days', rejected_food\)/);
    assert.match(sync, /revoke all on function public\.sync_apply\(jsonb\) from service_role/);
    assert.match(sync, /grant execute on function public\.sync_apply\(jsonb\) to authenticated/);
    const limit = sync.indexOf("raise exception 'too many food_days'");
    const write = sync.indexOf("insert into public.food_days");
    assert.equal(limit >= 0 && write > limit, true);
  });

  test("a null client push does not clear a non-null server goal without a newer clock", () => {
    assert.match(sql, /add column if not exists targets_updated_at timestamptz/);
    assert.match(sync, /dest\.protein_target_g is not null then dest\.protein_target_g/);
    assert.match(sync, /dest\.kcal_target is not null then dest\.kcal_target/);
    assert.match(sync, /src\.targets_updated_at > dest\.targets_updated_at/);
    assert.match(sync, /user_row \? 'protein_target_g'/);
    assert.match(sync, /user_row \? 'kcal_target'/);
    assert.equal(/when src\.protein_target_g is null then null/.test(sync), false);
    assert.equal(/when src\.kcal_target is null then null/.test(sync), false);
    const guard = sync.indexOf("dest.protein_target_g is not null then dest.protein_target_g");
    const foodWrite = sync.indexOf("insert into public.food_days");
    assert.equal(guard >= 0 && foodWrite > guard, true);
  });

  test("rejects non-integers and out-of-range protein and kcal", () => {
    assert.match(sync, /raise exception 'protein_target_g must be an integer'/);
    assert.match(sync, /raise exception 'protein_target_g out of range'/);
    assert.match(sync, /protein_num < 0 or protein_num > 500/);
    assert.match(sync, /raise exception 'kcal_target must be an integer'/);
    assert.match(sync, /raise exception 'kcal_target out of range'/);
    assert.match(sync, /kcal_num < 0 or kcal_num > 10000/);
    const check = sync.indexOf("raise exception 'protein_target_g out of range'");
    const write = sync.indexOf("update public.users as dest");
    assert.equal(check >= 0 && write > check, true);
  });

  test("weight_kg accepts 60.4 and rejects 10 and 400.5", () => {
    assert.equal(/weight_kg must be an integer/.test(sync), false);
    assert.match(sync, /weight_num <> round\(weight_num, 1\)/);
    assert.match(sync, /raise exception 'weight_kg must have at most 1 decimal'/);
    assert.match(sync, /raise exception 'weight_kg out of range'/);
    assert.match(sync, /weight_num < 20 or weight_num > 400/);
    const decimal = sync.indexOf("weight_num <> round(weight_num, 1)");
    const range = sync.indexOf("weight_num < 20 or weight_num > 400");
    const write = sync.indexOf("update public.users as dest");
    assert.equal(decimal >= 0 && range > decimal && write > range, true);
  });

  test("casts public.users.weight_kg to numeric(5,1) from the stored value", () => {
    assert.match(
      sql,
      /alter table public\.users\s+alter column weight_kg type numeric\(5,1\)\s+using round\(weight_kg::numeric, 1\)::numeric\(5,1\)/,
    );
    const alter = sql.indexOf("alter column weight_kg type numeric(5,1)");
    const fn = sql.indexOf("create or replace function public.sync_apply");
    assert.equal(alter >= 0 && fn > alter, true);
    assert.equal(/alter column weight_kg type integer/.test(sql), false);
  });

  test("rejects targets_updated_at more than 5 minutes in the future before any write", () => {
    assert.match(sync, /targets_at > now\(\) \+ interval '5 minutes'/);
    assert.match(
      sync,
      /raise exception 'targets_updated_at is more than 5 minutes in the future'/,
    );
    const check = sync.indexOf("targets_at > now() + interval '5 minutes'");
    const write = sync.indexOf("update public.users as dest");
    assert.equal(check >= 0 && write > check, true);
  });
});
