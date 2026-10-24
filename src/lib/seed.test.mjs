import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSeed, isLegacySeedId, mergeGymData, seedWorkoutWasEdited, stripLegacySeed } from "./seed.ts";

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
});
