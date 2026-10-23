import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SYNC_ERROR_LABEL, SYNC_ERROR_LABEL_SHORT, syncPhaseLabel } from "./status.ts";

describe("sync pill labels", () => {
  test("uses the approved copy", () => {
    assert.equal(syncPhaseLabel("local"), "Local");
    assert.equal(syncPhaseLabel("offline"), "Sin red · datos en el teléfono");
    assert.equal(syncPhaseLabel("syncing"), "Subiendo tu historial…");
    assert.equal(syncPhaseLabel("saved"), "Guardado en la nube");
    assert.equal(syncPhaseLabel("error"), "No se pudo subir · datos seguros en el teléfono");
    assert.equal(SYNC_ERROR_LABEL, syncPhaseLabel("error"));
    assert.equal(SYNC_ERROR_LABEL_SHORT, "Error · reintentar");
  });

  test("does not say the history was cleared", () => {
    const copy = ["local", "offline", "syncing", "saved", "error"].map((phase) => syncPhaseLabel(phase)).join(" ");
    assert.equal(/borrad|perdi|limpi|vac[ií]/.test(copy), false);
  });
});
