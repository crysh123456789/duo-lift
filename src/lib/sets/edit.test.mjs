import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createSeed } from "../seed.ts";
import { setDuoUnlocked } from "../session-flag.ts";
import { SET_COPY, SET_DELETE_ENABLED, commitSetDraft, editableSetSnapshot, setEditPatch } from "./edit.ts";
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

  test("con el flag prendido encola el tombstone y sigue ignorando ids de demo", () => {
    memory.clear();
    setSyncStorageUser("11111111-1111-4111-8111-111111111111");
    assert.equal(SET_DELETE_ENABLED, true);
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

  test("cancel discards the draft and listo writes only a real change", () => {
    const original = editableSetSnapshot({
      reps: 8,
      repsRight: null,
      weightKg: 40,
      durationSec: null,
      rpe: 7,
      isWarmup: false,
      completed: true,
    });
    assert.equal(commitSetDraft(original, { ...original }), null);
    assert.deepEqual(commitSetDraft(original, { ...original, weightKg: 55.5 }), {
      ...original,
      weightKg: 55.5,
    });
    const ui = readFileSync(new URL("../../components/logged-set-editor.tsx", import.meta.url), "utf8");
    const editStart = ui.indexOf('{mode === "edit"');
    const confirmStart = ui.indexOf('{mode === "confirm"');
    const editBlock = ui.slice(editStart, confirmStart);
    assert.match(ui, /function saveEdit\(\)/);
    assert.match(ui, /const patch = commitSetDraft\(editableSetSnapshot\(set\), draft\)/);
    assert.match(ui, /if \(patch\) onChange\(patch\)/);
    assert.match(ui, /function cancelEdit\(\)/);
    assert.match(editBlock, /onClick=\{saveEdit\}/);
    assert.match(editBlock, /onClick=\{cancelEdit\}/);
    assert.equal(/onChange\(/.test(editBlock), false);
  });

  test("edit mode hides Editar and Eliminar and puts Cancelar next to Listo", () => {
    const ui = readFileSync(new URL("../../components/logged-set-editor.tsx", import.meta.url), "utf8");
    const viewStart = ui.indexOf('{mode === "view"');
    const editStart = ui.indexOf('{mode === "edit"');
    const confirmStart = ui.indexOf('{mode === "confirm"');
    const viewBlock = ui.slice(viewStart, editStart);
    const editBlock = ui.slice(editStart, confirmStart);
    assert.match(viewBlock, /data-set-actions="view"/);
    assert.match(viewBlock, /SET_COPY\.edit/);
    assert.match(viewBlock, /SET_COPY\.delete/);
    assert.match(editBlock, /data-set-actions="edit"/);
    assert.equal(editBlock.includes("SET_COPY.edit"), false);
    assert.equal(editBlock.includes("SET_COPY.delete"), false);
    assert.equal(editBlock.includes("data-set-actions=\"view\""), false);
    assert.match(editBlock, /SET_COPY\.cancel/);
    assert.match(editBlock, /SET_COPY\.done/);
    assert.match(editBlock, /flex gap-2/);
    const shell = readFileSync(new URL("../../components/app-shell.tsx", import.meta.url), "utf8");
    assert.match(shell, /pb-32/);
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

  test("con el flag prendido Eliminar se ve, confirma, y un false no quita la serie", async () => {
    assert.equal(SET_DELETE_ENABLED, true);
    memory.clear();
    setSyncStorageUser("11111111-1111-4111-8111-111111111111");
    setDuoUnlocked(true);

    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { DeleteSetError, DeleteSetPending, LoggedSetEditor, finishSetDelete } = await import(
      "../../components/logged-set-editor.tsx"
    );
    const { StraightBlock } = await import("../../components/straight-block.tsx");
    const { useGymStore } = await import("../store.ts");

    const set = {
      id: "set-phone",
      stationId: "st-ui",
      roundIndex: 1,
      setIndex: 1,
      reps: 8,
      repsRight: null,
      weightKg: 40,
      durationSec: null,
      rpe: 7,
      isWarmup: false,
      completed: true,
      loggedAt: "2026-10-25T18:00:00.000Z",
    };
    const list = renderToStaticMarkup(
      createElement(LoggedSetEditor, {
        set,
        label: "Serie 1",
        unilateral: false,
        onChange() {},
        onDelete() {
          throw new Error("Eliminar no debe correr");
        },
      }),
    );
    assert.match(list, /Eliminar/);
    assert.match(list, /Editar/);
    assert.match(list, /data-set-actions="view"/);
    assert.equal(list.includes("¿Eliminar esta serie?"), false);

    const straight = renderToStaticMarkup(
      createElement(StraightBlock, {
        block: {
          id: "block-ui",
          workoutId: "workout-ui",
          position: 1,
          kind: "straight",
          name: null,
          targetRounds: 1,
          restBetweenRoundsSec: null,
          restSec: 90,
          stations: [
            {
              id: "st-ui",
              blockId: "block-ui",
              exerciseId: "ex-banca",
              position: 1,
              notes: null,
              exercise: {
                id: "ex-banca",
                name: "Press banca",
                muscleGroup: "chest",
                equipment: "barbell",
                isUnilateral: false,
                createdByUserId: null,
                duoId: null,
              },
              sets: [set],
            },
          ],
        },
      }),
    );
    assert.match(straight, /Eliminar serie/);
    assert.match(straight, /Press banca/);

    const pending = renderToStaticMarkup(createElement(DeleteSetPending));
    assert.match(pending, /Eliminando la serie/);
    assert.match(pending, /aria-busy="true"/);
    assert.match(pending, /data-set-editor="deleting"/);
    const error = renderToStaticMarkup(
      createElement(DeleteSetError, {
        onCancel() {},
        onRetry() {},
      }),
    );
    assert.match(error, /No se pudo eliminar/);
    assert.match(error, /No se borró nada más/);
    assert.match(error, /data-set-editor="error"/);
    assert.match(error, /Reintentar/);
    assert.equal(await finishSetDelete(() => false), "error");
    assert.equal(await finishSetDelete(() => true), "deleted");
    assert.equal(
      await finishSetDelete(() => {
        throw new Error("red");
      }),
      "error",
    );

    const before = useGymStore.getState().sets.length;
    useGymStore.setState({ sets: [...useGymStore.getState().sets, set] });
    assert.equal(useGymStore.getState().removeSet(set.id), true);
    assert.equal(useGymStore.getState().sets.some((row) => row.id === set.id), false);
    assert.equal(useGymStore.getState().sets.length, before);
    assert.deepEqual(readTombstones(), [{ entity: "sets", id: "set-phone" }]);

    memory.clear();
    const kept = { ...set, id: "set-locked" };
    useGymStore.setState({ sets: [...useGymStore.getState().sets, kept] });
    setDuoUnlocked(false);
    assert.equal(useGymStore.getState().removeSet(kept.id), false);
    assert.equal(useGymStore.getState().sets.some((row) => row.id === kept.id), true);
    assert.deepEqual(readTombstones(), []);
    setDuoUnlocked(true);

    const editor = readFileSync(new URL("../../components/logged-set-editor.tsx", import.meta.url), "utf8");
    assert.match(editor, /setMode\("deleting"\)/);
    assert.match(editor, /outcome === "error"/);
    assert.match(editor, /DeleteSetPending/);
    assert.match(editor, /DeleteSetError/);
    const straightSrc = readFileSync(new URL("../../components/straight-block.tsx", import.meta.url), "utf8");
    assert.match(straightSrc, /DeleteSetPending/);
    assert.match(straightSrc, /DeleteSetError/);
    assert.match(straightSrc, /phase: "deleting"/);
    assert.match(straightSrc, /phase: "error"/);

    for (const rel of [
      "../../components/logged-set-editor.tsx",
      "../../components/straight-block.tsx",
      "../../components/circuit-block.tsx",
      "../../app/workout/[id]/page.tsx",
      "../../app/dev/series/series-mock.tsx",
      "../store.ts",
      "../sync/set-delete.ts",
    ]) {
      const text = readFileSync(new URL(rel, import.meta.url), "utf8");
      assert.match(text, /SET_DELETE_ENABLED/, rel);
    }
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
