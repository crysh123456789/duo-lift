import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dailyVolume, personTrainingStats } from "./metrics.ts";
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
    assert.equal(days.at(-1).stamp, todayStamp(now));
    const sessionDays = new Set(data.workouts.map((row) => todayStamp(new Date(row.startedAt))));
    for (const stamp of sessionDays) {
      assert.equal(
        days.some((row) => row.stamp === stamp),
        true,
        stamp,
      );
    }
  });
});
