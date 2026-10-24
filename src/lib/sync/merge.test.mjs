import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { collapseFoodDays } from "../nutrition.ts";
import { ackMap, collectTombstones, mergeRemoteSnapshot } from "./merge.ts";
import { parseSnapshot, parseTombstones, toSyncPayload } from "./payload.ts";
import { gymFromRows } from "./rows.ts";
import { sameSnapshot } from "./snapshot.ts";

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
    members: [
      { duoId: "duo-1", userId: "user-cristian", role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" },
    ],
    exercises: [
      {
        id: "ex-banca",
        name: "Press banca",
        muscleGroup: "chest",
        equipment: "barbell",
        isUnilateral: false,
        createdByUserId: null,
        duoId: null,
      },
    ],
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

describe("mergeRemoteSnapshot", () => {
  test("keeps local-only rows when the server is empty", () => {
    const local = gym({
      workouts: [
        {
          id: "w-local",
          userId: "user-cristian",
          duoId: "duo-1",
          startedAt: "2026-10-01T18:00:00.000Z",
          endedAt: null,
          status: "in_progress",
          notes: null,
          perceivedExertion: null,
          title: "Pecho",
        },
      ],
    });
    const merged = mergeRemoteSnapshot(local, null, [], { seed: gym(), remindersFromServer: false });
    assert.equal(merged.workouts.some((row) => row.id === "w-local"), true);
  });

  test("unions remote rows and does not drop a local food day", () => {
    const local = gym({
      foodDays: [
        {
          id: "food-local",
          userId: "user-cristian",
          date: "2026-10-22",
          meals: { desayuno: "avena", mediaManana: "", almuerzo: "", mediaTarde: "", cena: "" },
          comment: "",
          rawInput: null,
          updatedAt: "2026-10-22T12:00:00.000Z",
        },
      ],
    });
    const remote = gym({
      workouts: [
        {
          id: "w-remote",
          userId: "user-cristian",
          duoId: "duo-1",
          startedAt: "2026-10-02T18:00:00.000Z",
          endedAt: "2026-10-02T19:00:00.000Z",
          status: "completed",
          notes: null,
          perceivedExertion: 8,
          title: "Pierna",
        },
      ],
    });
    const merged = mergeRemoteSnapshot(local, remote, [], { seed: gym(), remindersFromServer: true });
    assert.equal(merged.foodDays.some((row) => row.id === "food-local"), true);
    assert.equal(merged.workouts.some((row) => row.id === "w-remote"), true);
  });

  test("collapsing a same-date duplicate does not tombstone the absorbed id", () => {
    const breakfast = {
      id: "food-breakfast",
      userId: "user-cristian",
      date: "2026-10-20",
      meals: { desayuno: "huevos" },
      comment: "",
      rawInput: null,
      updatedAt: "2026-10-20T08:00:00.000Z",
    };
    const lunch = {
      id: "food-lunch",
      userId: "user-cristian",
      date: "2026-10-20",
      meals: { almuerzo: "pollo" },
      comment: "",
      rawInput: null,
      updatedAt: "2026-10-20T13:00:00.000Z",
    };
    const prev = gym({ foodDays: [breakfast, lunch] });
    const next = gym({ foodDays: collapseFoodDays(prev.foodDays) });
    const stones = collectTombstones(prev, next);
    assert.equal(stones.some((row) => row.entity === "foodDays"), false);
    assert.equal(next.foodDays.length, 1);
    assert.equal(next.foodDays[0].meals.desayuno.note, "huevos");
    assert.equal(next.foodDays[0].meals.almuerzo.note, "pollo");
    const removed = collectTombstones(prev, gym({ foodDays: [] }));
    assert.deepEqual(removed, [
      { entity: "foodDays", id: "food-breakfast" },
      { entity: "foodDays", id: "food-lunch" },
    ]);
  });

  test("an untouched seed exercise yields to the remote rename", () => {
    const seed = gym();
    const remote = gym({
      exercises: [{ ...seed.exercises[0], name: "Press banca cerrado" }],
    });
    const merged = mergeRemoteSnapshot(seed, remote, [], { seed, remindersFromServer: true });
    assert.equal(merged.exercises.find((row) => row.id === "ex-banca").name, "Press banca cerrado");
  });

  test("a newer set log wins, and a tombstone removes it", () => {
    const older = {
      id: "set-1",
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
      loggedAt: "2026-10-01T18:00:00.000Z",
    };
    const newer = { ...older, weightKg: 22.5, loggedAt: "2026-10-03T18:00:00.000Z" };
    const local = gym({ sets: [older] });
    const remote = gym({ sets: [newer] });
    const merged = mergeRemoteSnapshot(local, remote, [], { seed: gym(), ack: {}, remindersFromServer: true });
    assert.equal(merged.sets[0].weightKg, 22.5);

    const dropped = mergeRemoteSnapshot(local, remote, [{ entity: "sets", id: "set-1" }], {
      seed: gym(),
      remindersFromServer: true,
    });
    assert.equal(dropped.sets.length, 0);
  });

  test("a null local goal hydrates from the server, even before the first ack", () => {
    const local = gym();
    local.users[0] = { ...local.users[0], proteinTargetG: null, kcalTarget: null };
    const remote = gym();
    remote.users[0] = {
      ...remote.users[0],
      proteinTargetG: 120,
      kcalTarget: 2500,
      targetsUpdatedAt: "2026-10-24T15:00:00.000Z",
    };
    const saved = gym();
    saved.users[0] = { ...saved.users[0], proteinTargetG: 120, kcalTarget: 2500 };
    const merged = mergeRemoteSnapshot(local, remote, [], {
      seed: gym(),
      ack: ackMap(saved),
      preferLocal: true,
      remindersFromServer: false,
    });
    assert.equal(merged.users[0].proteinTargetG, 120);
    assert.equal(merged.users[0].kcalTarget, 2500);
    const payload = toSyncPayload(merged, []);
    assert.equal(payload.users[0].protein_target_g, 120);
    assert.equal(payload.users[0].kcal_target, 2500);
    assert.equal(Object.hasOwn(payload.users[0], "targets_updated_at"), false);
  });

  test("a newer explicit clear is not refilled from the server", () => {
    const local = gym();
    local.users[0] = {
      ...local.users[0],
      proteinTargetG: null,
      kcalTarget: null,
      proteinTargetUpdatedAt: "2026-10-24T16:00:00.000Z",
      kcalTargetUpdatedAt: "2026-10-24T16:00:00.000Z",
    };
    const remote = gym();
    remote.users[0] = {
      ...remote.users[0],
      proteinTargetG: 120,
      kcalTarget: 2500,
      targetsUpdatedAt: "2026-10-24T15:00:00.000Z",
    };
    const merged = mergeRemoteSnapshot(local, remote, [], {
      seed: gym(),
      preferLocal: false,
      remindersFromServer: true,
    });
    assert.equal(merged.users[0].proteinTargetG, null);
    assert.equal(merged.users[0].kcalTarget, null);
    const payload = toSyncPayload(merged, []);
    assert.equal(payload.users[0].protein_target_g, null);
    assert.equal(payload.users[0].kcal_target, null);
    assert.equal(payload.users[0].targets_updated_at, "2026-10-24T16:00:00.000Z");
  });

  test("a server-closed session replaces a stale open copy", () => {
    const local = gym({
      workouts: [
        {
          id: "w-sep12",
          userId: "user-cristian",
          duoId: "duo-1",
          startedAt: "2026-09-12T15:00:00.000Z",
          endedAt: null,
          status: "in_progress",
          notes: null,
          perceivedExertion: null,
          title: "Pierna",
        },
      ],
    });
    const remote = gym({
      workouts: [
        {
          id: "w-sep12",
          userId: "user-cristian",
          duoId: "duo-1",
          startedAt: "2026-09-12T15:00:00.000Z",
          endedAt: "2026-09-12T16:10:00.000Z",
          status: "completed",
          notes: null,
          perceivedExertion: null,
          title: "Pierna",
        },
      ],
    });
    const merged = mergeRemoteSnapshot(local, remote, [], {
      seed: gym(),
      preferLocal: true,
      remindersFromServer: false,
    });
    assert.equal(merged.workouts.find((row) => row.id === "w-sep12").status, "completed");
    assert.equal(merged.workouts.find((row) => row.id === "w-sep12").endedAt, "2026-09-12T16:10:00.000Z");
  });

  test("preferLocal keeps the phone workout even when the server copy is newer", () => {
    const local = gym({
      workouts: [
        {
          id: "w-local",
          userId: "user-cristian",
          duoId: "duo-1",
          startedAt: "2026-10-01T18:00:00.000Z",
          endedAt: null,
          status: "in_progress",
          notes: "en el teléfono",
          perceivedExertion: null,
          title: "Pecho",
        },
      ],
    });
    const remote = gym({
      workouts: [
        {
          id: "w-local",
          userId: "user-cristian",
          duoId: "duo-1",
          startedAt: "2026-10-20T18:00:00.000Z",
          endedAt: null,
          status: "in_progress",
          notes: null,
          perceivedExertion: null,
          title: "Reemplazado",
        },
      ],
    });
    const merged = mergeRemoteSnapshot(local, remote, [], {
      seed: gym(),
      preferLocal: true,
      remindersFromServer: false,
    });
    assert.equal(merged.workouts.find((row) => row.id === "w-local").title, "Pecho");
    assert.equal(merged.workouts.find((row) => row.id === "w-local").notes, "en el teléfono");
  });

  test("collectTombstones records removed sets and not the ones that remain", () => {
    const set = {
      id: "set-1",
      stationId: "st-1",
      roundIndex: 1,
      setIndex: 1,
      reps: 8,
      repsRight: null,
      weightKg: 20,
      durationSec: null,
      rpe: null,
      isWarmup: false,
      completed: false,
      loggedAt: "2026-10-01T18:00:00.000Z",
    };
    const prev = gym({ sets: [set, { ...set, id: "set-2" }] });
    const next = gym({ sets: [set] });
    assert.deepEqual(collectTombstones(prev, next), [{ entity: "sets", id: "set-2" }]);
  });
});

describe("payload", () => {
  test("maps a workout to snake_case and drops another duo", () => {
    const snapshot = gym({
      workouts: [
        {
          id: "w-1",
          userId: "user-cristian",
          duoId: "duo-1",
          startedAt: "2026-10-01T18:00:00.000Z",
          endedAt: null,
          status: "in_progress",
          notes: null,
          perceivedExertion: null,
          title: "Pecho",
        },
        {
          id: "w-other",
          userId: "user-cristian",
          duoId: "duo-other",
          startedAt: "2026-10-01T18:00:00.000Z",
          endedAt: null,
          status: "in_progress",
          notes: null,
          perceivedExertion: null,
          title: "No",
        },
      ],
      workingLoads: { "user-cristian:ex-banca": { weightKg: 40, reps: 8, repsRight: null } },
    });
    const payload = toSyncPayload(snapshot, [{ entity: "nope", id: "x" }, { entity: "sets", id: "set-1" }]);
    assert.equal(payload.duo.id, "duo-1");
    assert.deepEqual(
      payload.workouts.map((row) => row.id),
      ["w-1"],
    );
    assert.equal(payload.workouts[0].user_id, "user-cristian");
    assert.deepEqual(payload.working_loads, [
      { user_id: "user-cristian", exercise_id: "ex-banca", weight_kg: 40, reps: 8, reps_right: null },
    ]);
    assert.deepEqual(payload.tombstones, [{ entity: "sets", id: "set-1" }]);
  });

  test("rejects a snapshot whose duo id is not a client id", () => {
    assert.equal(parseSnapshot({ duo: { id: "drop table" } }), null);
    assert.equal(parseTombstones([{ entity: "users", id: "user-cristian" }]).length, 0);
  });
});

describe("gymFromRows", () => {
  test("coerces numeric strings and timestamptz into the client shape", () => {
    const { data, remindersFromServer } = gymFromRows({
      duo: {
        id: "duo-1",
        name: "Duo Lift",
        invite_code: "GYM2",
        created_at: "2026-01-01T00:00:00+00:00",
      },
      users: [
        {
          id: "user-cristian",
          email: "cristian@duo.lift",
          display_name: "Cristian",
          avatar_hue: 78,
          unit_system: "kg",
          height_cm: "167",
          weight_kg: "60.0",
          nutrition_goal: "surplus_muscle",
          created_at: "2026-01-01T00:00:00+00:00",
        },
      ],
      members: [],
      exercises: [],
      workouts: [],
      blocks: [],
      stations: [],
      sets: [
        {
          id: "set-1",
          station_id: "st-1",
          round_index: 1,
          set_index: 1,
          reps: 8,
          reps_right: null,
          weight_kg: "22.50",
          duration_sec: null,
          rpe: "8.5",
          is_warmup: false,
          completed: true,
          logged_at: "2026-10-03T18:00:00+00:00",
        },
      ],
      reactions: [],
      foodDays: [],
      loads: [],
      reminders: null,
    });
    assert.equal(remindersFromServer, false);
    assert.equal(data.users[0].weightKg, 60);
    assert.equal(data.users[0].proteinTargetG, null);
    assert.equal(data.users[0].kcalTarget, null);
    assert.equal(data.users[0].createdAt, "2026-01-01T00:00:00.000Z");
    assert.equal(data.sets[0].weightKg, 22.5);
    assert.equal(data.sets[0].loggedAt, "2026-10-03T18:00:00.000Z");
    assert.equal(sameSnapshot(data, data), true);
  });
});
