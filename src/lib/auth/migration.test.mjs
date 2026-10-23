import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const sql = readFileSync(new URL("../../../supabase/migrations/0007_auth_per_person.sql", import.meta.url), "utf8");
const engine = readFileSync(new URL("../sync/engine.ts", import.meta.url), "utf8");

describe("auth-per-person migration", () => {
  test("claims a legacy history only while claimed_by is null", () => {
    assert.match(sql, /set claimed_by = v_uid, claimed_at = now\(\)/);
    assert.match(sql, /and claimed_by is null/);
    assert.match(sql, /private\.legacy_claims/);
    assert.match(sql, /raise exception 'already_claimed'/);
    assert.match(sql, /raise exception 'already_decided'/);
  });

  test("scopes RLS to auth.uid and does not authorize from user_metadata or duo id", () => {
    assert.match(sql, /\(select auth\.uid\(\)\)::text/);
    const policies = [...sql.matchAll(/create policy [\s\S]*?;/g)].map((match) => match[0]);
    assert.equal(policies.length > 0, true);
    for (const policy of policies) {
      assert.equal(/user_metadata|jwt_duo_id|duo_id/.test(policy), false);
    }
    assert.match(sql, /revoke all on function public\.sync_apply\(jsonb\) from service_role/i);
    assert.match(sql, /grant execute on function public\.sync_apply\(jsonb\) to authenticated/i);
  });

  test("the sync loop compares the signed-in slice, not the whole phone cache", () => {
    assert.match(engine, /const latest = ownSnapshot\(userId\)/);
    assert.match(engine, /const started = ownSnapshot\(userId\)/);
  });
});
