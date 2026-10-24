import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { clearFoodDayLimitError, clearSyncApplyError, rejectedFoodDays } from "./rejected.ts";

const engine = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/sync/route.ts", import.meta.url), "utf8");

describe("rejected food days", () => {
  test("reads other-user and foreign ids from the sync_apply body", () => {
    const rows = rejectedFoodDays({
      ok: true,
      rejected: {
        food_days: [
          { id: "day-a", date: "2026-10-01", reason: "other_user" },
          { id: "day-b", date: null, reason: "foreign_id" },
          { id: "day-c", date: "2026-10-02", reason: "merged" },
          { id: "", reason: "other_user" },
        ],
      },
    });
    assert.deepEqual(rows, [
      { id: "day-a", date: "2026-10-01", reason: "other_user" },
      { id: "day-b", date: null, reason: "foreign_id" },
    ]);
    assert.deepEqual(rejectedFoodDays({ rejected: { food_days: [] } }), []);
    assert.deepEqual(rejectedFoodDays(null), []);
  });

  test("maps only the clear food_days limit errors", () => {
    assert.equal(clearFoodDayLimitError("too many food_days"), "too many food_days");
    assert.equal(
      clearFoodDayLimitError("food_days payload too large"),
      "food_days payload too large",
    );
    assert.equal(clearFoodDayLimitError("food_days must be an array"), "food_days must be an array");
    assert.equal(clearFoodDayLimitError("payload too large"), null);
    assert.equal(clearFoodDayLimitError("duplicate key value"), null);
    assert.equal(clearSyncApplyError("protein_target_g out of range"), "protein_target_g out of range");
    assert.equal(
      clearSyncApplyError("weight_kg must have at most 1 decimal"),
      "weight_kg must have at most 1 decimal",
    );
    assert.equal(clearSyncApplyError("weight_kg out of range"), "weight_kg out of range");
    assert.equal(
      clearSyncApplyError("targets_updated_at is more than 5 minutes in the future"),
      "targets_updated_at is more than 5 minutes in the future",
    );
    assert.equal(
      clearSyncApplyError("profile_updated_at must be a timestamp"),
      "profile_updated_at must be a timestamp",
    );
    assert.equal(
      clearSyncApplyError("profile_updated_at is more than 5 minutes in the future"),
      "profile_updated_at is more than 5 minutes in the future",
    );
    assert.equal(clearSyncApplyError("too many food_days"), "too many food_days");
    assert.equal(clearSyncApplyError("duplicate key value"), null);
  });

  test("the sync client surfaces rejections and does not drop the local days", () => {
    assert.match(engine, /const rejected = rejectedFoodDays\(pushed\)/);
    assert.match(engine, /setFoodDayRejection\(rejected\.length > 0\)/);
    assert.match(engine, /food days rejected:/);
    assert.equal(/foodDays\.filter\(/.test(engine), false);
    assert.match(route, /rejected: written\.rejected/);
    assert.match(route, /clearSyncApplyError/);
    const hydrate = engine.indexOf("usersWithServerTargets");
    const push = engine.indexOf("await push(prepared.snapshot");
    assert.equal(hydrate >= 0 && push > hydrate, true);
    assert.match(route, /error: clear/);
    assert.equal(/foreignFood/.test(route), false);
  });
});
