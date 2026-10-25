import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSeed, isLegacySeedId } from "../seed.ts";
import {
  historyPreserved,
  missingWorkoutIds,
  prepareSyncSnapshot,
  serverKeptWorkouts,
  tombstonesForRound,
} from "./round.ts";

const reminders = {
  enabled: false,
  lastFired: {},
  meals: {
    desayuno: { enabled: true, time: "08:00" },
    mediaManana: { enabled: true, time: "11:00" },
    almuerzo: { enabled: true, time: "13:00" },
    mediaTarde: { enabled: true, time: "16:30" },
    cena: { enabled: true, time: "20:00" },
  },
  gym: { enabled: true, time: "18:00" },
};

function gym(patch = {}) {
  return {
    users: [
      {
        id: "user-cristian",
        email: "cristian@duo.lift",
        displayName: "Cristian",
        avatarHue: 78,
        unitSystem: "kg",
        heightCm: 167,
        weightKg: 60,
        nutritionGoal: "surplus_muscle",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    duo: { id: "duo-1", name: "Duo Lift", inviteCode: "GYM2", createdAt: "2026-01-01T00:00:00.000Z" },
    members: [{ duoId: "duo-1", userId: "user-cristian", role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" }],
    exercises: [],
    workouts: [],
    blocks: [],
    stations: [],
    sets: [],
    reactions: [],
    workingLoads: {},
    foodDays: [],
    reminders,
    ...patch,
  };
}

function workout(id, title = "Pecho") {
  return {
    id,
    userId: "user-cristian",
    duoId: "duo-1",
    startedAt: "2026-10-01T18:00:00.000Z",
    endedAt: null,
    status: "in_progress",
    notes: null,
    perceivedExertion: null,
    title,
  };
}

function setRow(id, loggedAt = "2026-10-01T18:00:00.000Z") {
  return {
    id,
    stationId: "st-1",
    roundIndex: 1,
    setIndex: 1,
    reps: 8,
    repsRight: null,
    weightKg: 20,
    durationSec: null,
    rpe: null,
    isWarmup: false,
    completed: true,
    loggedAt,
  };
}

describe("first upload", () => {
  test("keeps the phone workout when the server has a tombstone and no ack yet", () => {
    const local = gym({ workouts: [workout("w-phone", "En el teléfono")] });
    const remote = gym({ workouts: [] });
    const stones = tombstonesForRound(true, local, [], [{ entity: "workouts", id: "w-phone" }], {});
    assert.equal(stones.length, 0);
    const prepared = prepareSyncSnapshot(local, remote, stones, { preferLocal: true, remindersFromServer: false });
    assert.equal(prepared.keepsHistory, true);
    assert.equal(prepared.snapshot.workouts.some((row) => row.id === "w-phone"), true);
    assert.equal(prepared.snapshot.workouts[0].title, "En el teléfono");
  });

  test("adds the other phone's workout without replacing this phone's row", () => {
    const local = gym({ workouts: [workout("w-phone", "Teléfono")] });
    const remote = gym({
      workouts: [workout("w-phone", "Servidor"), workout("w-other", "Otro teléfono")],
    });
    const prepared = prepareSyncSnapshot(local, remote, [], { preferLocal: true, remindersFromServer: false });
    assert.equal(prepared.snapshot.workouts.find((row) => row.id === "w-phone").title, "Teléfono");
    assert.equal(prepared.snapshot.workouts.some((row) => row.id === "w-other"), true);
  });

  test("refuses a snapshot that drops a workout without a tombstone", () => {
    const before = gym({ workouts: [workout("w-phone")] });
    const after = gym({ workouts: [] });
    assert.equal(historyPreserved(before, after, []), false);
    assert.equal(historyPreserved(before, after, [{ entity: "workouts", id: "w-phone" }]), true);
  });

  test("collapses a duplicate set slot and records a tombstone", () => {
    const local = gym({
      sets: [setRow("set-old", "2026-10-01T18:00:00.000Z"), setRow("set-new", "2026-10-02T18:00:00.000Z")],
    });
    const prepared = prepareSyncSnapshot(local, null, [], { preferLocal: true });
    assert.deepEqual(
      prepared.snapshot.sets.map((row) => row.id),
      ["set-new"],
    );
    assert.deepEqual(prepared.tombstones, [{ entity: "sets", id: "set-old" }]);
    assert.equal(prepared.keepsHistory, true);
  });

  test("an edited series wins, and a deleted one does not come back from the server", () => {
    const remoteSet = setRow("set-phone", "2026-10-01T18:00:00.000Z");
    const edited = { ...remoteSet, weightKg: 42.5, reps: 6, rpe: 8, loggedAt: "2026-10-25T15:00:00.000Z" };
    const kept = prepareSyncSnapshot(gym({ sets: [edited] }), gym({ sets: [remoteSet] }), [], {
      preferLocal: false,
    });
    assert.equal(kept.snapshot.sets[0].weightKg, 42.5);
    assert.equal(kept.snapshot.sets[0].reps, 6);
    assert.equal(kept.snapshot.sets[0].rpe, 8);

    const withoutTombstone = prepareSyncSnapshot(gym({ sets: [] }), gym({ sets: [remoteSet] }), []);
    assert.equal(withoutTombstone.snapshot.sets.some((row) => row.id === "set-phone"), true);

    const removed = prepareSyncSnapshot(gym({ sets: [] }), gym({ sets: [remoteSet] }), [
      { entity: "sets", id: "set-phone" },
    ]);
    assert.equal(removed.snapshot.sets.some((row) => row.id === "set-phone"), false);
    assert.equal(
      removed.tombstones.some((row) => row.entity === "sets" && row.id === "set-phone"),
      true,
    );
    assert.equal(removed.keepsHistory, true);
  });

  test("server ack must include every workout that was sent", () => {
    const sent = gym({ workouts: [workout("w-phone"), workout("w-other")] });
    assert.equal(serverKeptWorkouts(sent, gym({ workouts: [workout("w-phone")] }), []), false);
    assert.deepEqual(missingWorkoutIds(sent, gym({ workouts: [workout("w-phone")] }), []), ["w-other"]);
    assert.equal(
      serverKeptWorkouts(sent, gym({ workouts: [workout("w-phone")] }), [{ entity: "workouts", id: "w-other" }]),
      true,
    );
    assert.equal(serverKeptWorkouts(sent, null, []), false);
  });

  test("never emits tombstones for w-cr, w-am, or rx seed ids", () => {
    const local = gym({
      workouts: [workout("w-cr-d5"), workout("w-am-d1"), workout("w-phone")],
    });
    const stones = tombstonesForRound(
      true,
      local,
      [
        { entity: "workouts", id: "w-cr-d5" },
        { entity: "sets", id: "w-cr-d5-b1-s1-1" },
        { entity: "sets", id: "set-user" },
      ],
      [
        { entity: "workouts", id: "w-am-d1" },
        { entity: "reactions", id: "rx-am-d1-fire" },
      ],
      {},
    );
    assert.deepEqual(stones, [{ entity: "sets", id: "set-user" }]);
    const prepared = prepareSyncSnapshot(
      local,
      gym(),
      [
        { entity: "workouts", id: "w-cr-d5" },
        { entity: "workouts", id: "w-am-d1" },
        { entity: "reactions", id: "rx-am-d1-fire" },
        { entity: "sets", id: "set-user" },
      ],
      { preferLocal: true, remindersFromServer: false },
    );
    assert.equal(prepared.tombstones.some((row) => isLegacySeedId(row.id)), false);
    assert.equal(prepared.snapshot.workouts.some((row) => row.id === "w-cr-d5"), false);
    assert.equal(prepared.snapshot.workouts.some((row) => row.id === "w-am-d1"), false);
    assert.equal(prepared.snapshot.workouts.some((row) => row.id === "w-phone"), true);
    assert.equal(prepared.keepsHistory, true);
  });

  test("does not upload a food day tombstone while that day is still on the phone", () => {
    const day = {
      id: "food-1",
      userId: "user-cristian",
      date: "2026-10-20",
      meals: {},
      comment: "",
      rawInput: null,
      updatedAt: "2026-10-20T12:00:00.000Z",
    };
    const local = gym({ foodDays: [day] });
    const stones = tombstonesForRound(true, local, [{ entity: "foodDays", id: "food-1" }], [], {});
    assert.equal(stones.length, 0);
    const prepared = prepareSyncSnapshot(local, gym(), [{ entity: "foodDays", id: "food-1" }], {
      preferLocal: true,
      remindersFromServer: false,
    });
    assert.equal(prepared.tombstones.some((row) => row.entity === "foodDays"), false);
    assert.equal(prepared.snapshot.foodDays.some((row) => row.id === "food-1"), true);
    assert.equal(prepared.keepsHistory, true);
  });

  test("merges a duplicate food day per slot and does not tombstone the absorbed id", () => {
    const older = {
      id: "food-old",
      userId: "user-cristian",
      date: "2026-10-20",
      meals: {
        desayuno: {
          time: "08:00",
          note: "",
          items: [{ id: "huevo", name: "Huevo", grams: 50, proteinG: 6, carbsG: 0, fatG: 5 }],
        },
      },
      comment: "desayuno",
      rawInput: null,
      updatedAt: "2026-10-20T10:00:00.000Z",
    };
    const newer = {
      ...older,
      id: "food-new",
      meals: {
        almuerzo: {
          time: "13:00",
          note: "",
          items: [{ id: "pollo", name: "Pollo", grams: 150, proteinG: 40, carbsG: 0, fatG: 5 }],
        },
      },
      comment: "",
      updatedAt: "2026-10-20T12:00:00.000Z",
    };
    const prepared = prepareSyncSnapshot(gym({ foodDays: [older, newer] }), null, [], { preferLocal: true });
    assert.deepEqual(
      prepared.snapshot.foodDays.map((row) => row.id),
      ["food-new"],
    );
    assert.equal(prepared.tombstones.some((row) => row.entity === "foodDays"), false);
    assert.equal(prepared.snapshot.foodDays[0].meals.desayuno.items[0].name, "Huevo");
    assert.equal(prepared.snapshot.foodDays[0].meals.almuerzo.items[0].name, "Pollo");
    assert.equal(prepared.snapshot.foodDays[0].comment, "desayuno");
    assert.equal(prepared.keepsHistory, true);
    assert.equal(
      historyPreserved(gym({ foodDays: [older, newer] }), prepared.snapshot, prepared.tombstones),
      true,
    );
  });

  test("refuses a snapshot that drops a food day without a tombstone", () => {
    const day = {
      id: "food-1",
      userId: "user-cristian",
      date: "2026-10-20",
      meals: {},
      comment: "",
      rawInput: null,
      updatedAt: "2026-10-20T12:00:00.000Z",
    };
    assert.equal(historyPreserved(gym({ foodDays: [day] }), gym(), []), false);
    assert.equal(historyPreserved(gym({ foodDays: [day] }), gym(), [{ entity: "foodDays", id: "food-1" }]), true);
  });

  test("untouched demo stays out of the upload and does not become a delete", () => {
    const local = createSeed();
    const prepared = prepareSyncSnapshot(
      local,
      null,
      [
        { entity: "workouts", id: "w-cr-d5" },
        { entity: "workouts", id: "w-am-d1" },
        { entity: "reactions", id: "rx-am-d1-fire" },
      ],
      { preferLocal: true, remindersFromServer: false },
    );
    assert.equal(prepared.snapshot.workouts.length, 0);
    assert.equal(prepared.snapshot.sets.length, 0);
    assert.equal(prepared.snapshot.reactions.length, 0);
    assert.equal(Object.keys(prepared.snapshot.workingLoads).length, 0);
    assert.equal(prepared.tombstones.some((row) => isLegacySeedId(row.id)), false);
    assert.equal(prepared.keepsHistory, true);
  });
});
