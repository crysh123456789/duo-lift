import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dailyVolume, homeDashboardState, personTrainingStats } from "./metrics.ts";
import { todayStamp } from "./nutrition.ts";
import { createSeed } from "./seed.ts";

const AUTH = "11111111-1111-4111-8111-111111111111";

function completed(id, userId, startedAt) {
  return {
    id,
    userId,
    duoId: "duo-1",
    startedAt,
    endedAt: startedAt,
    status: "completed",
    notes: null,
    perceivedExertion: null,
    title: "Pierna",
  };
}

describe("inicio and progreso counts", () => {
  test("13 older sessions still count, and the week is separate", () => {
    const data = createSeed();
    data.workouts = Array.from({ length: 13 }, (_, index) =>
      completed(`w-real-${index}`, "user-cristian", new Date(2026, 0, 1 + index, 18).toISOString()),
    );
    const now = new Date(2026, 5, 1, 12);
    const stats = personTrainingStats(data, "user-cristian", now);
    assert.equal(stats.completed, 13);
    assert.equal(stats.weekCompleted, 0);
  });

  test("a lone account still counts rows left on one legacy person id", () => {
    const data = createSeed();
    data.users = [
      {
        ...data.users[0],
        id: AUTH,
      },
    ];
    data.workouts = [
      completed("w-real-1", "user-cristian", "2026-01-02T18:00:00.000Z"),
      completed("w-real-2", "user-cristian", "2026-01-03T18:00:00.000Z"),
    ];
    const stats = personTrainingStats(data, AUTH, new Date());
    assert.equal(stats.completed, 2);
  });

  test("untouched demo stays out of inicio and progreso", () => {
    const data = createSeed();
    const stats = personTrainingStats(data, "user-cristian", new Date());
    assert.equal(stats.completed, 0);
    assert.equal(stats.weekCompleted, 0);
    assert.equal(stats.volume, 0);
    const days = dailyVolume(data, 14, new Date());
    assert.equal(
      days.some((row) => data.users.some((user) => Number(row[user.id] ?? 0) > 0)),
      false,
    );
  });

  test("progreso includes every session date instead of four empty days", () => {
    const data = createSeed();
    data.users = data.users.filter((row) => row.id === "user-cristian");
    data.workouts = Array.from({ length: 13 }, (_, index) =>
      completed(`w-real-${index}`, "user-cristian", new Date(2026, 0, 1 + index * 3, 18).toISOString()),
    );
    const now = new Date(2026, 2, 1, 12);
    const days = dailyVolume(data, 14, now);
    assert.equal(days.length > 4, true);
    assert.equal(days[0].stamp, todayStamp(new Date(2026, 0, 1, 18)));
    assert.equal(days.at(-1).stamp, todayStamp(new Date(2026, 0, 1 + 12 * 3, 18)));
    const sessionDays = new Set(data.workouts.map((row) => todayStamp(new Date(row.startedAt))));
    assert.equal(days.length, sessionDays.size);
    for (const stamp of sessionDays) {
      assert.equal(
        days.some((row) => row.stamp === stamp),
        true,
        stamp,
      );
    }
  });

  test("progreso keeps August 19 and 20 and marks a zero-volume day", () => {
    const data = createSeed();
    data.users = data.users.filter((row) => row.id === "user-cristian");
    const stamps = [
      [2026, 7, 19],
      [2026, 7, 20],
      [2026, 7, 27],
      [2026, 7, 28],
      [2026, 7, 31],
      [2026, 8, 2],
      [2026, 8, 3],
      [2026, 8, 8],
      [2026, 8, 9],
      [2026, 8, 10],
      [2026, 8, 12],
    ];
    data.workouts = stamps.map(([year, month, day], index) =>
      completed(`w-${index}`, "user-cristian", new Date(year, month, day, 18).toISOString()),
    );
    const exerciseId = data.exercises[0].id;
    data.blocks = [
      {
        id: "b-aug19",
        workoutId: "w-0",
        position: 0,
        kind: "straight",
        name: null,
        targetRounds: 1,
        restBetweenRoundsSec: null,
        restSec: null,
      },
    ];
    data.stations = [
      { id: "st-aug19", blockId: "b-aug19", exerciseId, position: 0, notes: null },
    ];
    data.sets = [
      {
        id: "set-aug19",
        stationId: "st-aug19",
        roundIndex: 1,
        setIndex: 1,
        reps: 5,
        repsRight: null,
        weightKg: 20,
        durationSec: null,
        rpe: null,
        isWarmup: false,
        completed: true,
        loggedAt: new Date(2026, 7, 19, 19).toISOString(),
      },
    ];
    const now = new Date(2026, 9, 24, 12);
    const days = dailyVolume(data, 14, now);
    assert.equal(days[0].stamp, todayStamp(new Date(2026, 7, 19, 18)));
    assert.equal(days.some((row) => row.stamp === todayStamp(new Date(2026, 7, 20, 18))), true);
    assert.equal(days.length, stamps.length);
    assert.equal(days[0]["user-cristian"], 100);
    assert.equal(days[0]["user-cristian__zero"], 0);
    const quiet = days.find((row) => row.stamp === todayStamp(new Date(2026, 8, 12, 18)));
    assert.equal(quiet["user-cristian"], 0);
    assert.equal(quiet["user-cristian__zero"], 1);
    assert.equal(
      days.some((row) => row.stamp === todayStamp(new Date(2026, 7, 24, 12))),
      false,
    );
  });

  test("inicio hides the count and the open session until sync settles", () => {
    const open = { id: "w-sep12", status: "in_progress" };
    const hidden = homeDashboardState(false, {
      completed: 12,
      volume: 4000,
      weekCompleted: 1,
      weekVolume: 200,
      stale: [open],
    });
    assert.equal(hidden.ready, false);
    assert.equal(hidden.completed, null);
    assert.equal(hidden.volume, null);
    assert.deepEqual(hidden.stale, []);
    const shown = homeDashboardState(true, {
      completed: 13,
      volume: 4000,
      weekCompleted: 0,
      weekVolume: 0,
      stale: [],
    });
    assert.equal(shown.ready, true);
    assert.equal(shown.completed, 13);
    assert.equal(shown.stale.length, 0);
  });
});
