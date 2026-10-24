import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

describe("no legacy claim UI", () => {
  test("the claim route is gone and sign-in does not call claim_legacy_history", () => {
    assert.equal(existsSync(path.join(root, "src/app/claim/page.tsx")), false);
    const enter = readFileSync(path.join(root, "src/lib/auth/enter.ts"), "utf8");
    assert.equal(/return "claim"/.test(enter), false);
    assert.equal(/claim_legacy_history/.test(enter), false);
    assert.match(enter, /open\.length === 0/);
    assert.match(enter, /decline_legacy_history/);
    assert.match(enter, /attachClaimedHistory/);
    const phase = readFileSync(path.join(root, "src/lib/auth/phase.ts"), "utf8");
    assert.equal(/"claim"/.test(phase), false);
    for (const rel of [
      "src/components/auth-gate.tsx",
      "src/components/app-shell.tsx",
      "src/components/sync-provider.tsx",
    ]) {
      assert.equal(/\/claim/.test(readFileSync(path.join(root, rel), "utf8")), false, rel);
    }
    const ui = walk(path.join(root, "src")).filter((file) => file.endsWith(".tsx"));
    for (const file of ui) {
      const text = readFileSync(file, "utf8");
      assert.equal(/Traer tu historial|Traer historial|Historial de Kviedes|Empezar limpio|claim_legacy_history/.test(text), false, file);
    }
  });

  test("DUO_LIFT_PASSWORD is documented as unused and is not read anywhere else", () => {
    assert.equal(existsSync(path.join(root, "src/lib/duo-lock.ts")), false);
    assert.equal(existsSync(path.join(root, "src/lib/duo-lock.test.mjs")), false);
    const files = walk(root).filter((file) => {
      if (file.includes(`${path.sep}supabase${path.sep}migrations${path.sep}`)) return false;
      if (file.endsWith(`${path.sep}no-claim-ui.test.mjs`)) return false;
      return /\.(ts|tsx|mjs|js|yml|yaml|md|json|example)$/.test(file);
    });
    const hits = [];
    for (const file of files) {
      if (readFileSync(file, "utf8").includes("DUO_LIFT_PASSWORD")) hits.push(path.relative(root, file));
    }
    assert.deepEqual(hits, ["README.md"]);
    const readme = readFileSync(path.join(root, "README.md"), "utf8");
    assert.match(readme, /not read by the app, the tests, or CI/);
    assert.equal(readFileSync(path.join(root, ".env.example"), "utf8").includes("DUO_LIFT_PASSWORD"), false);
    assert.equal(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8").includes("DUO_LIFT_PASSWORD"), false);
    assert.equal(readFileSync(path.join(root, "src/app/api/session/route.ts"), "utf8").includes("DUO_LIFT_PASSWORD"), false);
    assert.match(
      readFileSync(path.join(root, "supabase/migrations/0007_auth_per_person.sql"), "utf8"),
      /DUO_LIFT_PASSWORD is retired by the app/,
    );
  });
});
