import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const sql = readFileSync(
  new URL("../../../supabase/migrations/0012_legacy_claim_binding.sql", import.meta.url),
  "utf8",
);
const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
const previous = readFileSync(
  new URL("../../../supabase/migrations/0007_auth_per_person.sql", import.meta.url),
  "utf8",
);
const claim = sql.slice(
  sql.indexOf("function private.claim_legacy_history"),
  sql.indexOf("comment on function private.claim_legacy_history"),
);
const sync = sql.slice(sql.indexOf("function public.sync_apply"));

describe("legacy claim binding", () => {
  test("does not edit 0007 and does not seed an allowed email", () => {
    assert.match(previous, /create or replace function private\.claim_legacy_history\(p_key text\)/);
    assert.equal(/allowed_email/.test(previous), false);
    assert.equal(/set allowed_email\s*=/.test(sql), false);
    assert.equal(/insert into private\.legacy_claims/i.test(sql), false);
  });

  test("fails closed unless lower(jwt email) matches lower(allowed_email)", () => {
    assert.match(sql, /add column allowed_email text/);
    assert.match(sql, /allowed_email = lower\(allowed_email\)/);
    assert.match(claim, /security definer/);
    assert.match(claim, /set search_path = ''/);
    assert.match(claim, /nullif\(lower\(btrim\(auth\.jwt\(\) ->> 'email'\)\), ''\)/);
    assert.match(claim, /lower\(v_claim\.allowed_email\)/);
    assert.match(claim, /raise exception 'claim_not_configured'/);
    assert.match(claim, /raise exception 'claim_email_mismatch'/);
    const closed = claim.indexOf("raise exception 'claim_not_configured'");
    const rewrite = claim.indexOf("insert into public.users");
    assert.equal(closed >= 0 && rewrite > closed, true);
  });

  test("reads email_confirmed_at from auth.users inside the definer, not from the JWT", () => {
    assert.match(claim, /select u\.email_confirmed_at/);
    assert.match(claim, /from auth\.users u/);
    assert.match(claim, /where u\.id = v_uid/);
    assert.match(claim, /raise exception 'email_not_confirmed'/);
    assert.equal(/->>\s*'email_confirmed_at'/.test(sql), false);
    assert.equal(/email_verified/.test(sql), false);
  });

  test("a missing code fails closed and there is no account-only branch", () => {
    assert.match(sql, /add column claim_code_hash text/);
    assert.match(claim, /if v_claim\.claim_code_hash is null then/);
    assert.match(claim, /raise exception 'claim_not_configured'/);
    assert.match(claim, /octet_length\(p_code\) between 1 and 72/);
    assert.match(claim, /'invalid_claim_code'/);
    assert.equal(/elsif[\s\S]{0,240}email_not_confirmed/.test(claim), false);
    assert.equal(/Pre-created account/.test(sql), false);
    assert.equal(/leave claim_code_hash null/.test(sql), false);
    assert.equal(/Deja `claim_code_hash` en null/.test(readme), false);
    assert.match(readme, /Se entrega en privado/);
    assert.match(readme, /claim_code_expires_at = now\(\) \+ interval '24 hours'/);
    assert.equal(/claim_code_hash is not null and v_claim\.claimed_by/.test(claim), false);
    const hashNull = claim.indexOf("if v_claim.claim_code_hash is null then");
    const configured = claim.indexOf("raise exception 'claim_not_configured'", hashNull);
    const rewrite = claim.indexOf("insert into public.users");
    assert.equal(hashNull >= 0 && configured > hashNull && rewrite > configured, true);
  });

  test("an expired code returns claim_code_expired after lockout and before the compare", () => {
    assert.match(sql, /add column claim_code_expires_at timestamptz/);
    assert.match(
      sql,
      /claim_code_hash is not null and claim_code_expires_at is not null/,
    );
    assert.match(claim, /claim_code_expires_at <= now\(\)/);
    assert.match(claim, /return jsonb_build_object\('ok', false, 'error', 'claim_code_expired'\)/);
    assert.equal(/raise exception 'claim_code_expired'/.test(claim), false);
    const locked = claim.indexOf("return jsonb_build_object('ok', false, 'error', 'claim_locked')");
    const expired = claim.indexOf("return jsonb_build_object('ok', false, 'error', 'claim_code_expired')");
    const compare = claim.indexOf("extensions.crypt(p_code, v_claim.claim_code_hash)");
    assert.equal(locked >= 0 && expired > locked && compare > expired, true);
  });

  test("a used code cannot be reused because success clears the hash", () => {
    const update = claim.slice(claim.indexOf("set\n        claimed_by = v_uid"));
    const hashClear = update.indexOf("claim_code_hash = null");
    const expiresClear = update.indexOf("claim_code_expires_at = null");
    const where = update.indexOf("where legacy_key = p_key");
    assert.equal(hashClear >= 0 && expiresClear > hashClear && where > expiresClear, true);
    assert.match(claim, /claimed_by = v_uid/);
    assert.equal(/claim_code_hash\s*=\s*'/.test(claim), false);
  });

  test("a wrong code still locks after repeated attempts", () => {
    assert.match(claim, /extensions\.crypt\(p_code, v_claim\.claim_code_hash\) = v_claim\.claim_code_hash/);
    assert.match(claim, /'claim_locked'/);
    assert.match(claim, /claim_code_total_failures >= 20/);
    assert.match(claim, />= 5 then now\(\) \+ interval '15 minutes'/);
    assert.match(claim, /p_code text default null/);
  });

  test("history trigger fires only when the row changes, and delete stays separate", () => {
    assert.match(
      sql,
      /create trigger food_days_history_trg\s+before update on public\.food_days\s+for each row\s+when \(old\.\* is distinct from new\.\*\)\s+execute function public\.food_days_history_capture\(\)/,
    );
    assert.match(
      sql,
      /create trigger food_days_history_delete_trg\s+before delete on public\.food_days\s+for each row\s+execute function public\.food_days_history_capture\(\)/,
    );
    assert.equal(/before update or delete on public\.food_days/.test(sql), false);
  });

  test("sync_apply rejects oversize food_days and returns foreign ids", () => {
    assert.match(sync, /raise exception 'food_days must be an array'/);
    assert.match(sync, /jsonb_array_length\(coalesce\(payload->'food_days', '\[\]'::jsonb\)\) > 5000/);
    assert.match(sync, /raise exception 'too many food_days'/);
    assert.match(sync, /octet_length\(coalesce\(payload->'food_days', '\[\]'::jsonb\)::text\) > 16777216/);
    assert.match(sync, /raise exception 'food_days payload too large'/);
    assert.match(sync, /'other_user'/);
    assert.match(sync, /'foreign_id'/);
    assert.match(sync, /'rejected', jsonb_build_object\('food_days', rejected_food\)/);
    assert.match(sync, /foreign_fd\.user_id is distinct from v_uid/);
    const limit = sync.indexOf("raise exception 'too many food_days'");
    const write = sync.indexOf("insert into public.food_days");
    assert.equal(limit >= 0 && write > limit, true);
  });
});
