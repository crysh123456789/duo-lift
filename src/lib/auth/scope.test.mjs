import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSeed } from "../seed.ts";
import { adoptAccount, attachClaimedHistory, rewriteLegacyOwner, scopeToUser, stitchGym } from "./scope.ts";

const AUTH_A = "11111111-1111-4111-8111-111111111111";

describe("per-person gym scope", () => {
  test("scopeToUser hides the other person's rows", () => {
    const seed = createSeed();
    const own = scopeToUser(seed, "user-cristian");
    assert.equal(own.workouts.length > 0, true);
    assert.equal(own.workouts.every((row) => row.userId === "user-cristian"), true);
    assert.equal(own.users.some((row) => row.id === "user-amigo"), false);
    assert.equal(own.foodDays.every((row) => row.userId === "user-cristian"), true);
    assert.equal(seed.workouts.some((row) => row.userId === "user-amigo"), true);
  });

  test("rewriteLegacyOwner leaves the other person in place", () => {
    const next = rewriteLegacyOwner(createSeed(), "user-cristian", AUTH_A);
    assert.equal(next.users.some((row) => row.id === "user-amigo"), true);
    assert.equal(next.users.some((row) => row.id === "user-cristian"), false);
    assert.equal(next.workouts.some((row) => row.userId === "user-amigo"), true);
    assert.equal(next.workouts.some((row) => row.userId === AUTH_A), true);
    assert.equal(next.workouts.some((row) => row.userId === "user-cristian"), false);
    assert.equal(
      Object.keys(next.workingLoads).some((key) => key.startsWith("user-cristian:")),
      false,
    );
    assert.equal(
      Object.keys(next.workingLoads).some((key) => key.startsWith(`${AUTH_A}:`)),
      true,
    );
  });

  test("stitchGym puts the synced slice back without dropping the other history", () => {
    const full = createSeed();
    const own = scopeToUser(rewriteLegacyOwner(full, "user-cristian", AUTH_A), AUTH_A);
    const stitched = stitchGym(full, own, AUTH_A);
    assert.equal(stitched.workouts.some((row) => row.userId === "user-amigo"), true);
    assert.equal(stitched.workouts.some((row) => row.userId === AUTH_A), true);
    assert.equal(stitched.duo.id, full.duo.id);
  });

  test("claiming Cristian retags only his rows and leaves Kviedes on user-amigo", () => {
    const next = attachClaimedHistory(
      createSeed(),
      {
        id: AUTH_A,
        email: "crysh@example.com",
        displayName: "Crysh",
        heightCm: 167,
        weightKg: 60,
      },
      "cristian",
    );
    assert.equal(next.workouts.some((row) => row.userId === "user-cristian"), false);
    assert.equal(next.workouts.some((row) => row.userId === AUTH_A), true);
    assert.equal(next.workouts.some((row) => row.id.startsWith("w-am-") && row.userId === "user-amigo"), true);
    const own = scopeToUser(next, AUTH_A);
    assert.equal(own.workouts.some((row) => row.id.startsWith("w-am-")), false);
    assert.equal(own.workouts.some((row) => row.id.startsWith("w-cr-")), true);
  });

  test("adoptAccount adds the profile and keeps everyone else", () => {
    const next = adoptAccount(createSeed(), {
      id: AUTH_A,
      email: "crysh@example.com",
      displayName: "Crysh",
      heightCm: 167,
      weightKg: 60,
    });
    assert.equal(next.users.some((row) => row.id === "user-amigo"), true);
    assert.equal(next.users.some((row) => row.id === "user-cristian"), true);
    assert.equal(next.users.find((row) => row.id === AUTH_A)?.displayName, "Crysh");
  });
});
