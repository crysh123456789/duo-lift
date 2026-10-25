import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createSeed } from "../seed.ts";
import { SET_COPY, setEditPatch } from "./edit.ts";
import { toSyncPayload } from "../sync/payload.ts";
import { queueSetDeletion, setDeletionTombstone } from "../sync/set-delete.ts";
import { readTombstones, setSyncStorageUser } from "../sync/storage.ts";

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

describe("series edits", () => {
  test("keeps weight, reps and the fields that already exist, and drops identity", () => {
    assert.deepEqual(
      setEditPatch({
        id: "nope",
        stationId: "other-station",
        roundIndex: 4,
        setIndex: 9,
        loggedAt: "nope",
        weightKg: 42.5,
        reps: 6,
        repsRight: null,
        rpe: 8,
        durationSec: 30,
        isWarmup: true,
        completed: true,
      }),
      {
        weightKg: 42.5,
        reps: 6,
        repsRight: null,
        rpe: 8,
        durationSec: 30,
        isWarmup: true,
        completed: true,
      },
    );
  });

  test("queues a tombstone for a real series and ignores demo ids", () => {
    memory.clear();
    setSyncStorageUser("11111111-1111-4111-8111-111111111111");
    assert.equal(setDeletionTombstone("w-cr-d5-b1-s1-1"), null);
    assert.deepEqual(setDeletionTombstone("set-phone"), { entity: "sets", id: "set-phone" });
    queueSetDeletion("w-cr-d5-b1-s1-1");
    queueSetDeletion("set-phone");
    assert.deepEqual(readTombstones(), [{ entity: "sets", id: "set-phone" }]);
  });

  test("the sync payload carries the edited fields and the delete", () => {
    const data = createSeed();
    data.sets = [
      {
        id: "set-phone",
        stationId: "st-1",
        roundIndex: 1,
        setIndex: 1,
        reps: 6,
        repsRight: 5,
        weightKg: 42.5,
        durationSec: 30,
        rpe: 8,
        isWarmup: true,
        completed: true,
        loggedAt: "2026-10-25T15:00:00.000Z",
      },
    ];
    const payload = toSyncPayload(data, [{ entity: "sets", id: "set-gone" }]);
    assert.deepEqual(payload.sets, [
      {
        id: "set-phone",
        station_id: "st-1",
        round_index: 1,
        set_index: 1,
        reps: 6,
        reps_right: 5,
        weight_kg: 42.5,
        duration_sec: 30,
        rpe: 8,
        is_warmup: true,
        completed: true,
        logged_at: "2026-10-25T15:00:00.000Z",
      },
    ]);
    assert.deepEqual(payload.tombstones, [{ entity: "sets", id: "set-gone" }]);
  });

  test("the editor copy is Colombian Spanish and the controls are at least 44px", () => {
    assert.equal(SET_COPY.confirmTitle, "¿Eliminar esta serie?");
    assert.match(SET_COPY.confirmBody, /teléfono/);
    assert.match(SET_COPY.confirmBody, /No vuelve a aparecer/);
    assert.equal(/vosotros|ordenador|vale/.test(Object.values(SET_COPY).join(" ")), false);
    const ui = readFileSync(new URL("../../components/logged-set-editor.tsx", import.meta.url), "utf8");
    assert.match(ui, /min-h-11/);
    assert.match(ui, /role="alertdialog"/);
    assert.match(ui, /SET_COPY/);
    const detail = readFileSync(new URL("../../app/workout/[id]/page.tsx", import.meta.url), "utf8");
    const straight = readFileSync(new URL("../../components/straight-block.tsx", import.meta.url), "utf8");
    const circuit = readFileSync(new URL("../../components/circuit-block.tsx", import.meta.url), "utf8");
    assert.match(detail, /LoggedSetEditor/);
    assert.match(straight, /DeleteSetConfirm/);
    assert.match(straight, /min-h-11/);
    assert.match(circuit, /LoggedSetEditor/);
  });

  test("the local mock never opens Supabase", () => {
    const proxy = readFileSync(new URL("../../proxy.ts", import.meta.url), "utf8");
    const gate = readFileSync(new URL("../../components/auth-gate.tsx", import.meta.url), "utf8");
    const mock = proxy.indexOf('pathname === "/dev/series"');
    const client = proxy.indexOf("createServerClient(");
    assert.equal(mock > 0 && mock < client, true);
    assert.match(proxy, /NODE_ENV !== "production"/);
    const mockGate = gate.indexOf("if (localSeriesMock)");
    const browser = gate.indexOf("createBrowserSupabaseClient()");
    assert.equal(mockGate > 0 && mockGate < browser, true);
    assert.match(gate, /setSyncUserId\(null\)/);
    const page = readFileSync(new URL("../../app/dev/series/page.tsx", import.meta.url), "utf8");
    assert.match(page, /NODE_ENV === "production"/);
    assert.match(page, /notFound\(\)/);
  });
});
