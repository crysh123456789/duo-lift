import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { applySyncItemResults, syncItemResults } from "./items.ts";

const engine = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/sync/route.ts", import.meta.url), "utf8");

function gym() {
  return {
    users: [],
    duo: { id: "duo-1", name: "Duo Lift", inviteCode: "GYM2", createdAt: "2026-01-01T00:00:00.000Z" },
    members: [],
    exercises: [
      {
        id: "ex-banca",
        name: "Banca",
        muscleGroup: "pecho",
        equipment: "barra",
        isUnilateral: false,
        createdByUserId: "user-cristian",
        duoId: null,
      },
    ],
    workouts: [
      {
        id: "w-1",
        userId: "user-cristian",
        duoId: "duo-1",
        startedAt: "2026-10-25T10:00:00.000Z",
        endedAt: null,
        status: "completed",
        notes: null,
        perceivedExertion: null,
        title: "Push",
      },
    ],
    blocks: [{ id: "b-1", workoutId: "w-1", position: 1, kind: "straight", name: null, targetRounds: 1, restBetweenRoundsSec: null, restSec: null }],
    stations: [{ id: "st-1", blockId: "b-1", exerciseId: "ex-banca", position: 1, notes: null }],
    sets: [
      set("set-live"),
      set("set-dead"),
      set("set-foreign"),
    ],
    reactions: [
      {
        id: "rx-1",
        workoutId: "w-1",
        fromUserId: "user-cristian",
        kind: "fire",
        body: null,
        createdAt: "2026-10-25T10:00:00.000Z",
      },
    ],
    workingLoads: { "user-cristian:ex-banca": { weightKg: 40, reps: 8, repsRight: null } },
    foodDays: [
      {
        id: "food-1",
        userId: "user-cristian",
        date: "2026-10-25",
        meals: {},
        comment: "",
        rawInput: null,
        updatedAt: "2026-10-25T10:00:00.000Z",
      },
    ],
    reminders: {
      enabled: false,
      lastFired: {},
      meals: {},
      gym: { enabled: false, time: "18:00" },
    },
  };
}

function set(id) {
  return {
    id,
    stationId: "st-1",
    roundIndex: 1,
    setIndex: 1,
    reps: 8,
    repsRight: null,
    weightKg: 40,
    durationSec: null,
    rpe: null,
    isWarmup: false,
    completed: true,
    loggedAt: "2026-10-25T10:00:00.000Z",
  };
}

describe("sync item results", () => {
  test("reads obsolete and rejected rows and ignores anything else", () => {
    const rows = syncItemResults({
      ok: true,
      items: [
        { entity: "sets", id: "set-dead", status: "obsolete" },
        { entity: "sets", id: "set-foreign", status: "rejected" },
        { entity: "sets", id: "set-live", status: "applied" },
        { entity: "nope", id: "x", status: "rejected" },
        { entity: "sets", id: "", status: "rejected" },
      ],
    });
    assert.deepEqual(rows, [
      { entity: "sets", id: "set-dead", status: "obsolete" },
      { entity: "sets", id: "set-foreign", status: "rejected" },
    ]);
    assert.deepEqual(
      syncItemResults({ rejected: { items: [{ entity: "workouts", id: "w-1", status: "obsolete" }] } }),
      [{ entity: "workouts", id: "w-1", status: "obsolete" }],
    );
    assert.deepEqual(syncItemResults(null), []);
  });

  test("drops rejected and obsolete rows and acknowledges the delete with a tombstone", () => {
    const decision = applySyncItemResults(gym(), [
      { entity: "sets", id: "set-dead", status: "obsolete" },
      { entity: "sets", id: "set-foreign", status: "rejected" },
      { entity: "reactions", id: "rx-1", status: "rejected" },
    ]);
    assert.deepEqual(
      decision.data.sets.map((row) => row.id),
      ["set-live"],
    );
    assert.deepEqual(decision.data.reactions, []);
    assert.equal(decision.data.foodDays[0].id, "food-1");
    assert.equal(decision.data.workouts[0].id, "w-1");
    assert.deepEqual(decision.tombstones, [{ entity: "sets", id: "set-dead" }]);
  });

  test("the sync client drops those rows and the route returns them", () => {
    assert.match(engine, /syncItemResults\(pushed\)/);
    assert.match(engine, /applySyncItemResults\(ownSnapshot\(userId\), outcomes\)/);
    assert.match(engine, /addTombstones\(decision\.tombstones\)/);
    assert.match(engine, /applyOwn\(decision\.data, userId\)/);
    assert.equal(/foodDays\.filter\(/.test(engine), false);
    assert.match(route, /items: written\.items/);
    assert.match(route, /skippedWorkouts/);
    assert.match(route, /!skippedWorkouts\.has\(id\)/);
    assert.match(engine, /missingWorkoutIds\(prepared\.snapshot, returned, prepared\.tombstones\)/);
    assert.match(engine, /!skippedWorkouts\.has\(id\)/);
    assert.match(engine, /retainUnsentDuplicateSets\(latest, followUp\.snapshot\)/);
  });
});
