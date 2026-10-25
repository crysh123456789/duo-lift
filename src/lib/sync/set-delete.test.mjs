import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { applySyncItemResults } from "./items.ts";
import { restoreRejectedSets, settleSetDeletes } from "./set-delete.ts";

const engine = readFileSync(new URL("./engine.ts", import.meta.url), "utf8");

function setRow(id) {
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

function gym(ids) {
  return {
    users: [],
    duo: { id: "duo-1", name: "Duo Lift", inviteCode: "GYM2", createdAt: "2026-01-01T00:00:00.000Z" },
    members: [],
    exercises: [],
    workouts: [],
    blocks: [],
    stations: [],
    sets: ids.map(setRow),
    reactions: [],
    workingLoads: {},
    foodDays: [],
    reminders: { enabled: false, lastFired: {}, meals: {}, gym: { enabled: false, time: "18:00" } },
  };
}

describe("set delete replies", () => {
  test("false keeps the tombstone and does not name any other series", () => {
    const settlement = settleSetDeletes({
      sent: [
        { entity: "sets", id: "set-false" },
        { entity: "workouts", id: "w-ok" },
      ],
      serverTombstones: [],
      items: [],
      serverSetIds: new Set(["set-false", "set-live"]),
    });
    assert.deepEqual(settlement.keepQueued, [{ entity: "sets", id: "set-false" }]);
    assert.equal(
      settlement.drain.some((row) => row.id === "set-false"),
      false,
    );
    assert.deepEqual(
      settlement.drain.find((row) => row.entity === "workouts"),
      { entity: "workouts", id: "w-ok" },
    );
    assert.deepEqual(settlement.keepSetIds, []);
    assert.equal(settlement.error, true);
    assert.equal(settlement.drain.some((row) => row.id === "set-live"), false);
  });

  test("false with the series already gone is resolved and leaves the live one", () => {
    const settlement = settleSetDeletes({
      sent: [{ entity: "sets", id: "set-gone" }],
      serverTombstones: [],
      items: [],
      serverSetIds: new Set(["set-live"]),
    });
    assert.deepEqual(settlement.drain, [{ entity: "sets", id: "set-gone" }]);
    assert.deepEqual(settlement.keepQueued, []);
    assert.equal(settlement.error, false);
    assert.equal(settlement.drain.some((row) => row.id === "set-live"), false);
  });

  test("rejected keeps the series, obsolete drains, and a sibling is not deleted", () => {
    const settlement = settleSetDeletes({
      sent: [
        { entity: "sets", id: "set-foreign" },
        { entity: "sets", id: "set-dead" },
      ],
      serverTombstones: [{ entity: "sets", id: "set-dead" }],
      items: [
        { entity: "sets", id: "set-foreign", status: "rejected" },
        { entity: "sets", id: "set-dead", status: "obsolete" },
      ],
      serverSetIds: new Set(["set-foreign", "set-live"]),
    });
    assert.deepEqual(settlement.keepSetIds, ["set-foreign"]);
    assert.equal(settlement.error, true);
    assert.equal(
      settlement.drain.some((row) => row.id === "set-dead"),
      true,
    );
    assert.equal(
      settlement.keepQueued.some((row) => row.id === "set-foreign"),
      false,
    );
    assert.equal(settlement.drain.some((row) => row.id === "set-live"), false);

    const decision = applySyncItemResults(gym(["set-live", "set-foreign", "set-dead"]), [
      { entity: "sets", id: "set-foreign", status: "rejected" },
      { entity: "sets", id: "set-dead", status: "obsolete" },
    ]);
    assert.deepEqual(
      decision.data.sets.map((row) => row.id),
      ["set-live", "set-foreign"],
    );
    assert.deepEqual(decision.tombstones, [{ entity: "sets", id: "set-dead" }]);

    const restored = restoreRejectedSets(gym(["set-live"]), gym(["set-live", "set-foreign", "set-other"]), [
      "set-foreign",
    ]);
    assert.deepEqual(
      restored.sets.map((row) => row.id),
      ["set-live", "set-foreign"],
    );
    assert.equal(restored.sets.some((row) => row.id === "set-other"), false);
  });

  test("an accepted queued tombstone drains and the sync client uses that settlement", () => {
    const settlement = settleSetDeletes({
      sent: [{ entity: "sets", id: "set-vieja" }],
      serverTombstones: [{ entity: "sets", id: "set-vieja" }],
      items: [],
      serverSetIds: new Set(["set-viva"]),
    });
    assert.deepEqual(settlement.drain, [{ entity: "sets", id: "set-vieja" }]);
    assert.equal(settlement.error, false);
    assert.equal(settlement.drain.some((row) => row.id === "set-viva"), false);

    assert.match(engine, /settleSetDeletes\(/);
    assert.match(engine, /restoreRejectedSets\(/);
    assert.match(engine, /removeTombstones\(settlement\.drain\)/);
    assert.match(engine, /set delete not applied/);
    assert.equal(/removeTombstones\(prepared\.tombstones\)/.test(engine), false);
  });
});
