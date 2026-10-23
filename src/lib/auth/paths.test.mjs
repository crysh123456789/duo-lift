import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isAuthScreen, isGuestOnlyAuthScreen } from "./paths.ts";

describe("auth screens", () => {
  test("forgot and reset are public, and only reset keeps a signed-in person", () => {
    for (const path of ["/login", "/signup", "/forgot", "/reset"]) {
      assert.equal(isAuthScreen(path), true);
    }
    assert.equal(isAuthScreen("/"), false);
    assert.equal(isAuthScreen("/reset/extra"), false);
    assert.equal(isGuestOnlyAuthScreen("/forgot"), true);
    assert.equal(isGuestOnlyAuthScreen("/login"), true);
    assert.equal(isGuestOnlyAuthScreen("/reset"), false);
  });
});
