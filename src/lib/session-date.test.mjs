import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dailyVolume } from "./metrics.ts";
import {
  CTA_CHANGE_DATE,
  CTA_CLOSE,
  CTA_FOLLOW,
  DATE_FIELD_HINT,
  DATE_FIELD_LABEL,
  DATE_UPDATED,
  UNCLOSED_TITLE,
  atLocalStamp,
  homeTrainCta,
  isValidStamp,
  omitWorkout,
  planSplitStart,
  reusableOpenId,
  sessionStamp,
  shiftStartedAt,
  staleOpenWorkout,
  todayOpenWorkout,
  unclosedBadge,
  unclosedBody,
} from "./session-date.ts";
import { groupDuoSessions } from "./session-groups.ts";
import { ackMap, collectTombstones, mergeRemoteSnapshot } from "./sync/merge.ts";
import { toSyncPayload } from "./sync/payload.ts";

const USER = "user-cristian";
const NOW = new Date(2026, 9, 23, 15, 45, 0);
const TODAY = "2026-10-23";
const YESTERDAY = "2026-10-22";

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
        id: USER,
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
    members: [{ duoId: "duo-1", userId: USER, role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" }],
    exercises: [
      {
        id: "ex-remo",
        name: "Remo",
        muscleGroup: "back",
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

function workout(patch) {
  return {
    id: "w-old",
    userId: USER,
    duoId: "duo-1",
    startedAt: new Date(2026, 9, 23, 19, 5, 0).toISOString(),
    endedAt: null,
    status: "in_progress",
    notes: null,
    perceivedExertion: null,
    title: "Espalda y bíceps",
    ...patch,
  };
}

function logged(id, stationId, weightKg, reps, at) {
  return {
    id,
    stationId,
    roundIndex: 1,
    setIndex: 1,
    reps,
    repsRight: null,
    weightKg,
    durationSec: null,
    rpe: null,
    isWarmup: false,
    completed: true,
    loggedAt: at,
  };
}

describe("session date", () => {
  test("uses the locked copy", () => {
    assert.equal(UNCLOSED_TITLE, "Tienes una sesión sin cerrar");
    assert.equal(DATE_FIELD_LABEL, "Fecha del entreno");
    assert.equal(DATE_FIELD_HINT, "Así el historial queda en el día correcto.");
    assert.equal(DATE_UPDATED, "Fecha actualizada");
    assert.equal(CTA_FOLLOW, "Seguir");
    assert.equal(CTA_CHANGE_DATE, "Cambiar fecha");
    assert.equal(CTA_CLOSE, "Cerrar");
  });

  test("a chosen yesterday stays on that calendar day and keeps the clock", () => {
    const startedAt = atLocalStamp(YESTERDAY, NOW);
    assert.equal(sessionStamp(startedAt), YESTERDAY);
    assert.equal(new Date(startedAt).getHours(), 15);
    assert.equal(new Date(startedAt).getMinutes(), 45);
    assert.equal(isValidStamp("2026-10-24", TODAY), false);
    assert.equal(isValidStamp("2026-02-31", TODAY), false);
    assert.equal(shiftStartedAt(startedAt, "2026-10-24", TODAY), null);
  });

  test("an old open session stays distinct from a new today session", () => {
    const friday = new Date(2026, 9, 23, 19, 5, 0).toISOString();
    const thursday = shiftStartedAt(friday, YESTERDAY, TODAY);
    const oldOpen = workout({ id: "w-old", startedAt: thursday, title: "Espalda y bíceps" });
    const todayOpen = workout({ id: "w-today", startedAt: friday, title: "Pierna" });
    const workouts = [oldOpen, todayOpen];

    assert.equal(staleOpenWorkout(workouts, USER, NOW)?.id, "w-old");
    assert.equal(todayOpenWorkout(workouts, USER, NOW)?.id, "w-today");
    assert.equal(reusableOpenId(workouts, USER, TODAY), "w-today");
    assert.equal(reusableOpenId([oldOpen], USER, TODAY), null);
    assert.deepEqual(
      planSplitStart([oldOpen], USER, TODAY, "pierna", () => "espalda-biceps"),
      { action: "create" },
    );
    assert.deepEqual(
      planSplitStart([oldOpen], USER, YESTERDAY, "espalda-biceps", () => "espalda-biceps"),
      { action: "reuse", id: "w-old" },
    );

    const body = unclosedBody(oldOpen.title, oldOpen.startedAt, NOW);
    const badge = unclosedBadge(oldOpen.startedAt, NOW);
    assert.match(body, /^Espalda y bíceps · Ayer · /);
    assert.match(badge, /^Sin cerrar · Ayer · /);
    assert.doesNotMatch(body, /hoy/i);
    assert.doesNotMatch(badge, /hoy/i);
    assert.doesNotMatch(badge, /Sesión de hoy/);
    assert.equal(homeTrainCta([oldOpen], USER, NOW), null);
    assert.equal(homeTrainCta(workouts, USER, NOW), "Seguir pierna");
    assert.notEqual(homeTrainCta(workouts, USER, NOW), "Seguir espalda y bíceps");
  });

  test("closing the old session does not wipe today's log or the food diary", () => {
    const thursday = atLocalStamp(YESTERDAY, NOW);
    const friday = atLocalStamp(TODAY, NOW);
    const food = {
      id: "food-1",
      userId: USER,
      date: YESTERDAY,
      meals: { desayuno: "avena", mediaManana: "", almuerzo: "", mediaTarde: "", cena: "" },
      comment: "",
      rawInput: null,
      updatedAt: thursday,
    };
    const prev = gym({
      workouts: [
        workout({ id: "w-old", startedAt: thursday }),
        workout({ id: "w-today", startedAt: friday, title: "Pierna" }),
      ],
      blocks: [
        {
          id: "b-old",
          workoutId: "w-old",
          position: 1,
          kind: "straight",
          name: null,
          targetRounds: 1,
          restBetweenRoundsSec: null,
          restSec: null,
        },
        {
          id: "b-today",
          workoutId: "w-today",
          position: 1,
          kind: "straight",
          name: null,
          targetRounds: 1,
          restBetweenRoundsSec: null,
          restSec: null,
        },
      ],
      stations: [
        { id: "st-old", blockId: "b-old", exerciseId: "ex-remo", position: 1, notes: null },
        { id: "st-today", blockId: "b-today", exerciseId: "ex-remo", position: 1, notes: null },
      ],
      sets: [
        logged("set-old", "st-old", 10, 8, thursday),
        logged("set-today", "st-today", 20, 5, friday),
      ],
      foodDays: [food],
    });
    const next = { ...prev, ...omitWorkout(prev, "w-old") };
    const dropped = collectTombstones(prev, next).map((row) => row.id);
    assert.deepEqual(dropped.sort(), ["b-old", "set-old", "st-old", "w-old"]);
    assert.deepEqual(next.workouts.map((row) => row.id), ["w-today"]);
    assert.deepEqual(next.blocks.map((row) => row.id), ["b-today"]);
    assert.equal(next.foodDays.length, 1);
    assert.equal(next.sets[0].id, "set-today");
  });

  test("a workout dated yesterday shows on that day in history and progress", () => {
    const thursday = atLocalStamp(YESTERDAY, NOW);
    const friday = atLocalStamp(TODAY, NOW);
    const oldOpen = workout({ id: "w-old", startedAt: thursday, title: "Espalda y bíceps" });
    const todayDone = workout({
      id: "w-today",
      startedAt: friday,
      endedAt: friday,
      status: "completed",
      title: "Pierna",
    });
    const data = gym({
      workouts: [oldOpen, todayDone],
      blocks: [
        {
          id: "b-old",
          workoutId: "w-old",
          position: 1,
          kind: "straight",
          name: null,
          targetRounds: 1,
          restBetweenRoundsSec: null,
          restSec: null,
        },
        {
          id: "b-today",
          workoutId: "w-today",
          position: 1,
          kind: "straight",
          name: null,
          targetRounds: 1,
          restBetweenRoundsSec: null,
          restSec: null,
        },
      ],
      stations: [
        { id: "st-old", blockId: "b-old", exerciseId: "ex-remo", position: 1, notes: null },
        { id: "st-today", blockId: "b-today", exerciseId: "ex-remo", position: 1, notes: null },
      ],
      sets: [
        logged("set-old", "st-old", 10, 8, thursday),
        logged("set-today", "st-today", 20, 5, friday),
      ],
    });

    const history = groupDuoSessions(data, data.workouts);
    assert.equal(history.length, 1);
    assert.equal(history[0].kind, "solo");
    assert.equal(sessionStamp(history[0].workout.startedAt), TODAY);
    assert.equal(staleOpenWorkout(data.workouts, USER, NOW)?.id, "w-old");
    assert.match(unclosedBadge(oldOpen.startedAt, NOW), /^Sin cerrar · /);
    assert.equal(sessionStamp(oldOpen.startedAt), YESTERDAY);

    const days = dailyVolume(data, 14, NOW);
    const thu = days.find((row) => row.stamp === YESTERDAY);
    const fri = days.find((row) => row.stamp === TODAY);
    assert.equal(thu[USER], 80);
    assert.equal(fri[USER], 100);
    assert.match(String(thu.label), /Ayer/);
    assert.doesNotMatch(String(thu.label), /hoy/i);
    assert.match(String(fri.label), /Hoy/);
  });
});

describe("sync keeps the corrected date and the other session", () => {
  test("a date edit and a new today session both survive merge", () => {
    const friday = new Date(2026, 9, 23, 19, 5, 0).toISOString();
    const thursday = shiftStartedAt(friday, YESTERDAY, TODAY);
    const remoteWorkout = workout({ id: "w-old", startedAt: friday, title: "Espalda y bíceps" });
    const corrected = { ...remoteWorkout, startedAt: thursday, updatedAt: "2099-01-01T00:00:00.000Z" };
    const todayWorkout = workout({ id: "w-today", startedAt: friday, title: "Pierna" });
    const food = {
      id: "food-1",
      userId: USER,
      date: YESTERDAY,
      meals: { desayuno: "avena", mediaManana: "", almuerzo: "", mediaTarde: "", cena: "" },
      comment: "",
      rawInput: null,
      updatedAt: thursday,
    };
    const remote = gym({ workouts: [remoteWorkout] });
    const local = gym({ workouts: [corrected, todayWorkout], foodDays: [food] });
    const ack = ackMap(remote);

    const merged = mergeRemoteSnapshot(local, remote, [], {
      seed: gym(),
      ack,
      remindersFromServer: true,
    });
    assert.equal(merged.workouts.find((row) => row.id === "w-old").startedAt, thursday);
    assert.equal(merged.workouts.find((row) => row.id === "w-today").title, "Pierna");
    assert.equal(merged.foodDays.some((row) => row.id === "food-1"), true);

    const withoutAck = mergeRemoteSnapshot(local, remote, [], {
      seed: gym(),
      remindersFromServer: true,
    });
    assert.equal(withoutAck.workouts.find((row) => row.id === "w-old").startedAt, thursday);
    assert.equal(withoutAck.workouts.find((row) => row.id === "w-today").id, "w-today");

    const payload = toSyncPayload(local, []);
    assert.equal(payload.workouts.find((row) => row.id === "w-old").started_at, thursday);
    assert.equal(payload.workouts.find((row) => row.id === "w-today").started_at, friday);
  });
});
