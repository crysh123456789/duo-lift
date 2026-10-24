import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  EMAIL_RATE_LIMIT_COOLDOWN_SECONDS,
  EMAIL_RATE_LIMIT_MESSAGE,
  FORGOT_SUCCESS_MESSAGE,
  PASSWORDS_DO_NOT_MATCH,
  RECOVERY_LINK_INVALID,
  authErrorMessage,
  forgotOutcome,
  passwordUpdateMessage,
  validateNewPassword,
} from "./errors.ts";

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

  test("maps a bad login", () => {
    assert.equal(
      authErrorMessage({ code: "invalid_credentials" }, "login"),
      "Correo o contraseña incorrectos.",
    );
  });

  test("forgot success is identical when the account is missing", () => {
    assert.equal(FORGOT_SUCCESS_MESSAGE, "Si hay cuenta con ese correo, te enviamos un enlace.");
    assert.deepEqual(forgotOutcome(null), { ok: true });
    assert.deepEqual(forgotOutcome({ code: "user_not_found", message: "User not found" }), { ok: true });
    assert.deepEqual(forgotOutcome({ message: "Email not found" }), { ok: true });
  });

  test("forgot rate limit uses one message and a short cooldown", () => {
    assert.equal(EMAIL_RATE_LIMIT_MESSAGE, "Espera un momento y vuelve a intentar");
    assert.equal(EMAIL_RATE_LIMIT_COOLDOWN_SECONDS >= 3 && EMAIL_RATE_LIMIT_COOLDOWN_SECONDS <= 10, true);
    const limited = forgotOutcome({
      code: "over_email_send_rate_limit",
      message: "For security purposes, you can only request this after 42 seconds.",
    });
    assert.deepEqual(limited, {
      ok: false,
      message: EMAIL_RATE_LIMIT_MESSAGE,
      cooldownSeconds: EMAIL_RATE_LIMIT_COOLDOWN_SECONDS,
    });
    assert.deepEqual(forgotOutcome({ status: 429, message: "Email rate limit exceeded" }), limited);
    assert.deepEqual(forgotOutcome({ code: "email_address_invalid", message: "Unable to validate email address" }), {
      ok: false,
      message: "Revisa el correo.",
      cooldownSeconds: 0,
    });
  });

  test("reset rejects a mismatch, a short password, and a dead recovery session", () => {
    assert.equal(validateNewPassword("short", "short"), "La contraseña es demasiado corta. Mínimo 8 caracteres.");
    assert.equal(validateNewPassword("long-enough", "other-pass"), PASSWORDS_DO_NOT_MATCH);
    assert.equal(validateNewPassword("long-enough", "long-enough"), null);
    assert.equal(
      passwordUpdateMessage({ message: "New password should be different from the old password." }),
      "Elige una contraseña distinta a la anterior.",
    );
    assert.equal(passwordUpdateMessage({ message: "Auth session missing!" }), RECOVERY_LINK_INVALID);
    assert.equal(passwordUpdateMessage({ code: "weak_password" }), "La contraseña es demasiado corta. Mínimo 8 caracteres.");
  });
});
