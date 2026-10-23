import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { PASSWORD_RECOVERY_REDIRECT_TO, classifyRecoveryArrival, openRecoverySession } from "./recovery.ts";

const GAMMA_RESET = "https://duo-lift-gamma.vercel.app/reset";

function client(overrides = {}) {
  const calls = { initialize: 0, exchange: 0, verify: 0, signOut: 0, getSession: 0 };
  let listener = () => {};
  const supabase = {
    auth: {
      onAuthStateChange(callback) {
        listener = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async initialize() {
        calls.initialize += 1;
        if (overrides.initialize) return overrides.initialize(listener);
        return { error: null };
      },
      async verifyOtp(args) {
        calls.verify += 1;
        calls.verifyArgs = args;
        return overrides.verifyOtp ?? { data: { session: null }, error: { message: "expired" } };
      },
      async exchangeCodeForSession(code, options) {
        calls.exchange += 1;
        calls.exchangeArgs = { code, options };
        if (overrides.exchange) return overrides.exchange(listener);
        return { data: { session: null }, error: { code: "otp_expired", status: 400, message: "expired" } };
      },
      async getSession() {
        calls.getSession += 1;
        return overrides.getSession ?? { data: { session: null } };
      },
      async signOut(args) {
        calls.signOut += 1;
        calls.signOutArgs = args;
        return { error: null };
      },
    },
  };
  return { supabase, calls };
}

describe("password recovery", () => {
  test("the email redirect is gamma /reset", () => {
    assert.equal(PASSWORD_RECOVERY_REDIRECT_TO, GAMMA_RESET);
    assert.equal(/localhost/i.test(PASSWORD_RECOVERY_REDIRECT_TO), false);
  });

  test("classifies the callback without treating a normal visit as a session", () => {
    assert.deepEqual(classifyRecoveryArrival(`${GAMMA_RESET}?code=abc&sb_flow_id=flowflow1`), {
      kind: "code",
      code: "abc",
      flowId: "flowflow1",
    });
    assert.deepEqual(classifyRecoveryArrival(`${GAMMA_RESET}?code=abc&sb_flow_id=bad`), {
      kind: "code",
      code: "abc",
    });
    assert.deepEqual(classifyRecoveryArrival(`${GAMMA_RESET}?token_hash=hash-1&type=recovery`), {
      kind: "token",
      tokenHash: "hash-1",
    });
    assert.equal(classifyRecoveryArrival(`${GAMMA_RESET}?token_hash=hash-1&type=email`).kind, "none");
    assert.equal(
      classifyRecoveryArrival(`${GAMMA_RESET}?error=access_denied&error_code=otp_expired&error_description=expired`).kind,
      "invalid",
    );
    assert.equal(classifyRecoveryArrival(`${GAMMA_RESET}#error=access_denied&error_code=otp_expired`).kind, "invalid");
    assert.equal(classifyRecoveryArrival(`${GAMMA_RESET}#access_token=secret&type=recovery`).kind, "invalid");
    assert.equal(classifyRecoveryArrival(GAMMA_RESET).kind, "none");
  });

  test("a recovery event or a consumed code opens the form", async () => {
    const heard = client({
      initialize(listener) {
        setTimeout(() => listener("PASSWORD_RECOVERY", { access_token: "session" }), 0);
        return { error: null };
      },
    });
    const arrival = classifyRecoveryArrival(`${GAMMA_RESET}?code=abc`);
    assert.equal(await openRecoverySession(heard.supabase, arrival, () => `${GAMMA_RESET}?code=abc`), "ready");
    assert.equal(heard.calls.exchange, 0);

    let href = `${GAMMA_RESET}?code=abc`;
    const consumed = client({
      initialize() {
        href = GAMMA_RESET;
        return { error: null };
      },
      getSession: { data: { session: { access_token: "session" } } },
    });
    assert.equal(await openRecoverySession(consumed.supabase, arrival, () => href), "ready");
    assert.equal(consumed.calls.exchange, 0);
    assert.equal(consumed.calls.signOut, 0);
  });

  test("verifyOtp accepts a recovery token hash and an expired one stays shut", async () => {
    const ok = client({
      verifyOtp: { data: { session: { access_token: "session" } }, error: null },
    });
    const token = classifyRecoveryArrival(`${GAMMA_RESET}?token_hash=hash-1&type=recovery`);
    assert.equal(await openRecoverySession(ok.supabase, token, () => GAMMA_RESET), "ready");
    assert.deepEqual(ok.calls.verifyArgs, { type: "recovery", token_hash: "hash-1" });

    const expired = client();
    assert.equal(await openRecoverySession(expired.supabase, token, () => GAMMA_RESET), "invalid");
    assert.equal(await openRecoverySession(expired.supabase, { kind: "invalid" }, () => GAMMA_RESET), "invalid");
    assert.equal(expired.calls.initialize, 1);
  });

  test("a missing verifier or a dead code is an invalid link, and a network failure can retry", async () => {
    const href = `${GAMMA_RESET}?code=once`;
    const arrival = classifyRecoveryArrival(href);
    const missing = client();
    assert.equal(await openRecoverySession(missing.supabase, arrival, () => href), "invalid");
    assert.equal(missing.calls.signOut, 0);

    const other = client({
      exchange: () => ({ data: { session: { access_token: "other" } }, error: null }),
    });
    assert.equal(await openRecoverySession(other.supabase, arrival, () => href), "invalid");
    assert.equal(other.calls.signOut, 1);
    assert.deepEqual(other.calls.signOutArgs, { scope: "local" });

    const down = client({
      exchange: () => ({ data: { session: null }, error: { status: 503, message: "unavailable" } }),
    });
    assert.equal(await openRecoverySession(down.supabase, arrival, () => href), "failed");

    const thrown = client({
      initialize() {
        throw new Error("offline");
      },
    });
    assert.equal(await openRecoverySession(thrown.supabase, arrival, () => href), "failed");
  });

  test("the screens call Supabase and do not send people to localhost", () => {
    const forgot = readFileSync(new URL("../../app/forgot/page.tsx", import.meta.url), "utf8");
    const reset = readFileSync(new URL("../../app/reset/page.tsx", import.meta.url), "utf8");
    const login = readFileSync(new URL("../../app/login/page.tsx", import.meta.url), "utf8");
    assert.match(login, /href="\/forgot"/);
    assert.match(login, /¿Olvidaste tu contraseña\?/);
    assert.match(forgot, /resetPasswordForEmail/);
    assert.match(forgot, /PASSWORD_RECOVERY_REDIRECT_TO/);
    assert.match(forgot, /FORGOT_SUCCESS_MESSAGE/);
    assert.match(forgot, /Enviar enlace/);
    assert.match(forgot, /EMAIL_RATE_LIMIT_MESSAGE/);
    assert.match(forgot, /secondsLeft > 0/);
    assert.match(forgot, /Volver a entrar/);
    assert.match(reset, /updateUser\(\{ password \}\)/);
    assert.match(reset, /Guardar y entrar/);
    assert.match(reset, /Confirmar/);
    for (const source of [forgot, reset, login]) {
      assert.equal(/localhost/i.test(source), false);
      assert.equal(/console\.(log|debug|info|error|warn)/.test(source), false);
      assert.equal(/error\.message/.test(source), false);
    }
  });
});
