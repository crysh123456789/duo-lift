import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { authErrorMessage, claimErrorMessage } from "./errors.ts";

describe("auth copy", () => {
  test("maps signup collisions and short passwords", () => {
    assert.equal(
      authErrorMessage({ message: "User already registered" }, "signup"),
      "Ese correo ya tiene cuenta.",
    );
    assert.equal(
      authErrorMessage({ code: "weak_password", message: "Password should be at least 6 characters" }, "signup"),
      "La contraseña es demasiado corta. Mínimo 8 caracteres.",
    );
  });

  test("maps bad login and one-shot claim failures", () => {
    assert.equal(
      authErrorMessage({ code: "invalid_credentials" }, "login"),
      "Correo o contraseña incorrectos.",
    );
    assert.equal(claimErrorMessage({ message: "already_claimed" }), "Ese historial ya lo trajo otra cuenta.");
    assert.equal(claimErrorMessage({ message: "already_decided" }), "Ya elegiste. No se puede cambiar.");
    assert.equal(claimErrorMessage({ message: "not_authenticated" }), "La sesión caducó. Entra de nuevo.");
  });
});
