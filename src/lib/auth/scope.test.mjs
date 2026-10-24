import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSeed } from "../seed.ts";
import { adoptAccount, attachClaimedHistory, rewriteLegacyOwner, scopeToUser, stitchGym } from "./scope.ts";

const AUTH_A = "11111111-1111-4111-8111-111111111111";

function withRealHistory(data) {
  const next = structuredClone(data);
  next.workouts.push({
    id: "w-real-1",
    userId: "user-cristian",
    duoId: data.duo.id,
    startedAt: "2026-10-20T18:00:00.000Z",
    endedAt: "2026-10-20T19:00:00.000Z",
    status: "completed",
    notes: null,
    perceivedExertion: null,
    title: "Pierna real",
  });
  next.workingLoads["user-cristian:ex-real"] = { weightKg: 123, reps: 5, repsRight: null };
  return next;
}

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

  test("rewriteLegacyOwner leaves the other person and the demo rows in place", () => {
    const next = rewriteLegacyOwner(withRealHistory(createSeed()), "user-cristian", AUTH_A);
    assert.equal(next.users.some((row) => row.id === "user-amigo"), true);
    assert.equal(next.users.some((row) => row.id === "user-cristian"), false);
    assert.equal(next.workouts.some((row) => row.userId === "user-amigo"), true);
    assert.equal(next.workouts.find((row) => row.id === "w-real-1").userId, AUTH_A);
    assert.equal(
      next.workouts.filter((row) => row.id.startsWith("w-cr-")).every((row) => row.userId === "user-cristian"),
      true,
    );
    assert.equal(next.workingLoads[`${AUTH_A}:ex-real`].weightKg, 123);
    assert.equal(
      Object.keys(next.workingLoads).some((key) => key.startsWith("user-cristian:")),
      true,
    );
    assert.equal(
      Object.keys(next.workingLoads).filter((key) => key.startsWith(`${AUTH_A}:`)).join(","),
      `${AUTH_A}:ex-real`,
    );
  });

  test("stitchGym puts the synced slice back without dropping the other history", () => {
    const full = withRealHistory(createSeed());
    const own = scopeToUser(rewriteLegacyOwner(full, "user-cristian", AUTH_A), AUTH_A);
    const stitched = stitchGym(full, own, AUTH_A);
    assert.equal(own.workouts.some((row) => row.id.startsWith("w-cr-")), false);
    assert.equal(stitched.workouts.some((row) => row.userId === "user-amigo"), true);
    assert.equal(stitched.workouts.some((row) => row.id === "w-real-1" && row.userId === AUTH_A), true);
    assert.equal(
      stitched.workouts.some((row) => row.id.startsWith("w-cr-") && row.userId === "user-cristian"),
      true,
    );
    assert.equal(stitched.duo.id, full.duo.id);
  });

  test("claiming Cristian moves real rows and leaves demo sessions on the legacy account", () => {
    const next = attachClaimedHistory(
      withRealHistory(createSeed()),
      {
        id: AUTH_A,
        email: "crysh@example.com",
        displayName: "Crysh",
        heightCm: 167,
        weightKg: 60,
      },
      "cristian",
    );
    assert.equal(next.workouts.find((row) => row.id === "w-real-1").userId, AUTH_A);
    assert.equal(
      next.workouts.filter((row) => row.id.startsWith("w-cr-")).every((row) => row.userId === "user-cristian"),
      true,
    );
    assert.equal(next.workouts.some((row) => row.id.startsWith("w-am-") && row.userId === "user-amigo"), true);
    const own = scopeToUser(next, AUTH_A);
    assert.equal(own.workouts.some((row) => row.id.startsWith("w-am-")), false);
    assert.equal(own.workouts.some((row) => row.id.startsWith("w-cr-")), false);
    assert.equal(own.workouts.some((row) => row.id === "w-real-1"), true);
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
    assert.equal(next.users.find((row) => row.id === AUTH_A)?.proteinTargetG ?? null, null);
    assert.equal(next.users.find((row) => row.id === AUTH_A)?.kcalTarget ?? null, null);
  });

  test("claim keeps food days, retags only the claimed person, and copies manual goals", () => {
    const data = withRealHistory(createSeed());
    data.foodDays = [
      {
        id: "food-cr",
        userId: "user-cristian",
        date: "2026-10-20",
        meals: {},
        comment: "",
        rawInput: null,
        updatedAt: "2026-10-20T12:00:00.000Z",
      },
      {
        id: "food-am",
        userId: "user-amigo",
        date: "2026-10-20",
        meals: {},
        comment: "kviedes",
        rawInput: null,
        updatedAt: "2026-10-20T12:00:00.000Z",
      },
    ];
    data.users = data.users.map((user) =>
      user.id === "user-cristian" ? { ...user, proteinTargetG: 90, kcalTarget: 2200 } : user,
    );
    const next = attachClaimedHistory(
      data,
      {
        id: AUTH_A,
        email: "crysh@example.com",
        displayName: "Crysh",
        heightCm: 167,
        weightKg: 60,
      },
      "cristian",
    );
    assert.equal(next.foodDays.find((row) => row.id === "food-cr").userId, AUTH_A);
    assert.equal(next.foodDays.find((row) => row.id === "food-am").userId, "user-amigo");
    assert.equal(next.users.find((row) => row.id === AUTH_A).proteinTargetG, 90);
    assert.equal(next.users.find((row) => row.id === AUTH_A).kcalTarget, 2200);
    assert.equal(next.users.find((row) => row.id === "user-amigo").proteinTargetG ?? null, null);
  });
});
