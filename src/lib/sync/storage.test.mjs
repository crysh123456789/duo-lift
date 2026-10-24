import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readTombstones, seedLegacyTombstones, setSyncStorageUser } from "./storage.ts";

const memory = new Map();

globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => {
    memory.set(key, String(value));
  },
  removeItem: (key) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
};

describe("legacy tombstone queue", () => {
  test("does not copy seed workout ids into the account queue", () => {
    memory.clear();
    const userId = "11111111-1111-4111-8111-111111111111";
    localStorage.setItem(
      "duo-lift-sync-tombstones",
      JSON.stringify([
        { entity: "workouts", id: "w-cr-d5" },
        { entity: "workouts", id: "w-am-d1" },
        { entity: "sets", id: "w-cr-d5-b1-s1-1" },
        { entity: "reactions", id: "rx-am-d1-fire" },
        { entity: "sets", id: "set-user" },
      ]),
    );
    setSyncStorageUser(userId);
    seedLegacyTombstones(
      userId,
      new Set(["w-cr-d5", "w-am-d1", "w-cr-d5-b1-s1-1", "rx-am-d1-fire", "set-user"]),
    );
    assert.deepEqual(readTombstones(), [{ entity: "sets", id: "set-user" }]);
  });
});
