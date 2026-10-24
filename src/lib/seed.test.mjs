import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createAccountSeed,
  createSeed,
  isLegacySeedId,
  isUntouchedDemo,
  mergeGymData,
  omitDemo,
  omitSeedHistory,
  seedWorkoutWasEdited,
  stripLegacySeed,
} from "./seed.ts";

function workoutIdForSet(data, setId) {
  const set = data.sets.find((row) => row.id === setId);
  const station = data.stations.find((row) => row.id === set.stationId);
  const block = data.blocks.find((row) => row.id === station.blockId);
  return block.workoutId;
}

function firstSet(data, workoutId) {
  const blockIds = new Set(data.blocks.filter((row) => row.workoutId === workoutId).map((row) => row.id));
  const stationIds = new Set(data.stations.filter((row) => blockIds.has(row.blockId)).map((row) => row.id));
  return data.sets.find((row) => stationIds.has(row.stationId));
}

describe("legacy seed cleanup", () => {
  test("drops only pristine demo workouts", () => {
    const seed = createSeed();
    const stripped = stripLegacySeed(seed, seed);
    assert.equal(
      stripped.workouts.some((row) => isLegacySeedId(row.id)),
      false,
    );
    assert.equal(stripped.sets.some((row) => isLegacySeedId(row.id)), false);
    assert.equal(stripped.reactions.some((row) => row.id === "rx-am-d1-fire"), false);
  });

  test("keeps w-cr and w-am workouts when any set was edited", () => {
    const seed = createSeed();
    const edited = structuredClone(seed);
    const cr = firstSet(edited, "w-cr-d5");
    const am = firstSet(edited, "w-am-d1");
    cr.weightKg = 999;
    am.reps = (am.reps ?? 0) + 1;
    edited.sets.push({
      ...cr,
      id: "set-user-added",
      weightKg: 77,
      reps: 3,
    });
    edited.workouts.push({
      ...edited.workouts[0],
      id: "w-real-13",
      title: "Sesión real",
    });

    const stripped = stripLegacySeed(edited, seed);
    assert.equal(stripped.workouts.some((row) => row.id === "w-cr-d5"), true);
    assert.equal(stripped.workouts.some((row) => row.id === "w-am-d1"), true);
    assert.equal(stripped.workouts.some((row) => row.id === "w-real-13"), true);
    assert.equal(stripped.workouts.some((row) => row.id === "w-cr-d4"), false);
    assert.equal(stripped.workouts.some((row) => row.id === "w-am-d4"), false);
    assert.equal(stripped.sets.find((row) => row.id === cr.id).weightKg, 999);
    assert.equal(stripped.sets.some((row) => row.id === "set-user-added"), true);
    assert.equal(stripped.reactions.some((row) => row.workoutId === "w-cr-d5"), true);
    assert.equal(seedWorkoutWasEdited(edited, "w-cr-d5", seed), true);
    assert.equal(seedWorkoutWasEdited(edited, "w-am-d1", seed), true);
    assert.equal(seedWorkoutWasEdited(seed, "w-cr-d4", seed), false);
    assert.equal(workoutIdForSet(edited, cr.id), "w-cr-d5");
  });

  test("merge does not resurrect a pristine demo after the version-6 cleanup", () => {
    const seed = createSeed();
    const edited = structuredClone(seed);
    const cr = firstSet(edited, "w-cr-d5");
    cr.weightKg = 999;
    const cleaned = stripLegacySeed(edited, seed);
    const merged = mergeGymData(cleaned, seed, { preferSeedLoads: true });
    const dropped = stripLegacySeed(merged, seed);
    assert.equal(dropped.workouts.some((row) => row.id === "w-cr-d5"), true);
    assert.equal(dropped.sets.find((row) => row.id === cr.id).weightKg, 999);
    assert.equal(dropped.workouts.some((row) => row.id === "w-cr-d4"), false);
    assert.equal(dropped.workouts.some((row) => row.id === "w-am-d4"), false);
    assert.equal(merged.workouts.some((row) => row.id === "w-cr-d4"), true);
  });

  test("a drifted clock is still demo, and a date correction is not", () => {
    const seed = createSeed();
    const drifted = structuredClone(seed);
    const workout = drifted.workouts.find((row) => row.id === "w-cr-d4");
    workout.startedAt = "2020-01-01T18:12:00.000Z";
    assert.equal(isUntouchedDemo(drifted, "w-cr-d4", seed), true);
    assert.equal(omitDemo(drifted, seed).workouts.some((row) => row.id === "w-cr-d4"), false);

    const corrected = structuredClone(seed);
    const edited = corrected.workouts.find((row) => row.id === "w-cr-d5");
    edited.startedAt = "2026-02-02T18:12:00.000Z";
    edited.updatedAt = "2026-02-02T19:00:00.000Z";
    assert.equal(isUntouchedDemo(corrected, "w-cr-d5", seed), false);
    assert.equal(omitDemo(corrected, seed).workouts.some((row) => row.id === "w-cr-d5"), true);
  });

  test("a new account seed has no example history and no example loads", () => {
    const account = createAccountSeed();
    assert.equal(account.workouts.length, 0);
    assert.equal(account.blocks.length, 0);
    assert.equal(account.sets.length, 0);
    assert.equal(account.reactions.length, 0);
    assert.deepEqual(account.workingLoads, {});
    assert.equal(account.exercises.length > 0, true);
    assert.equal(omitDemo(createSeed()).workouts.length, 0);
    assert.deepEqual(omitDemo(createSeed()).workingLoads, {});
  });

  test("an authenticated view drops seed ids even after the session was edited", () => {
    const seed = createSeed();
    const edited = structuredClone(seed);
    const workout = edited.workouts.find((row) => row.id === "w-cr-d5");
    workout.title = "Pecho real";
    workout.updatedAt = "2026-02-02T19:00:00.000Z";
    workout.userId = "11111111-1111-4111-8111-111111111111";
    const view = omitSeedHistory(edited, seed);
    assert.equal(view.workouts.some((row) => row.id === "w-cr-d5"), false);
    assert.equal(view.workouts.some((row) => row.id.startsWith("w-am-")), false);
    assert.equal(view.reactions.some((row) => row.id.startsWith("rx-")), false);
    assert.equal(omitDemo(edited, seed).workouts.some((row) => row.id === "w-cr-d5"), true);
  });
});
