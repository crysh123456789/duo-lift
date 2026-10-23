import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, describe, test } from "node:test";
import {
  DUO_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  attachSessionCookie,
  clearSessionCookie,
  duoPassword,
  isValidSession,
  sessionCookieOptions,
  sessionToken,
} from "./duo-lock.ts";

const require = createRequire(import.meta.url);
const { NextResponse } = require("next/server");

const envSnapshot = {
  NODE_ENV: process.env.NODE_ENV,
  DUO_LIFT_PASSWORD: process.env.DUO_LIFT_PASSWORD,
};

afterEach(() => {
  if (envSnapshot.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = envSnapshot.NODE_ENV;
  if (envSnapshot.DUO_LIFT_PASSWORD === undefined) delete process.env.DUO_LIFT_PASSWORD;
  else process.env.DUO_LIFT_PASSWORD = envSnapshot.DUO_LIFT_PASSWORD;
});

function usePassword(password, nodeEnv = "test") {
  process.env.NODE_ENV = nodeEnv;
  if (password === undefined) delete process.env.DUO_LIFT_PASSWORD;
  else process.env.DUO_LIFT_PASSWORD = password;
}

describe("duoPassword", () => {
  test("development without DUO_LIFT_PASSWORD uses the duolift fallback", () => {
    usePassword(undefined, "development");
    assert.equal(duoPassword(), "duolift");
  });

  test("non-development without DUO_LIFT_PASSWORD stays open", () => {
    usePassword(undefined, "production");
    assert.equal(duoPassword(), "");
    assert.equal(isValidSession("anything"), false);
  });

  test("explicit password wins in development", () => {
    usePassword("clave", "development");
    assert.equal(duoPassword(), "clave");
  });
});

describe("session token", () => {
  test("accepts a fresh token and rejects invented, tampered, and legacy static tokens", () => {
    usePassword("clave");
    const now = 1_800_000_000_000;
    const token = sessionToken("clave", Math.floor(now / 1000));
    assert.equal(isValidSession(token, now), true);
    assert.equal(isValidSession("not-a-session", now), false);
    assert.equal(isValidSession(undefined, now), false);
    assert.equal(isValidSession("", now), false);
    assert.equal(isValidSession(`${token}x`, now), false);
    const [version, issued, sig] = token.split(".");
    assert.equal(isValidSession(`${version}.${issued}.${sig.slice(0, -1)}a`, now), false);
    assert.equal(isValidSession(`${version}.${Number(issued) + 5}.${sig}`, now), false);
    const legacy = "a".repeat(64);
    assert.equal(isValidSession(legacy, now), false);
  });

  test("rejects tokens older than the max age and tokens issued too far in the future", () => {
    usePassword("clave");
    const now = 1_800_000_000_000;
    const nowSec = Math.floor(now / 1000);
    const fresh = sessionToken("clave", nowSec - SESSION_MAX_AGE_SECONDS + 1);
    const expired = sessionToken("clave", nowSec - SESSION_MAX_AGE_SECONDS);
    const soon = sessionToken("clave", nowSec + 60);
    const future = sessionToken("clave", nowSec + 61);
    assert.equal(isValidSession(fresh, now), true);
    assert.equal(isValidSession(expired, now), false);
    assert.equal(isValidSession(soon, now), true);
    assert.equal(isValidSession(future, now), false);
  });

  test("a token for another password does not validate", () => {
    usePassword("clave");
    const token = sessionToken("otra");
    assert.equal(isValidSession(token), false);
  });
});

describe("session cookie", () => {
  test("production sets Secure, HttpOnly, SameSite=lax, and the max age", () => {
    usePassword("clave", "production");
    assert.equal(sessionCookieOptions().secure, true);
    const res = NextResponse.json({ ok: true });
    attachSessionCookie(res, sessionToken());
    const header = res.headers.getSetCookie().join("\n");
    assert.match(header, new RegExp(`^${DUO_COOKIE}=v1\\.\\d+\\.`));
    assert.match(header, /HttpOnly/);
    assert.match(header, /Secure/);
    assert.match(header, /SameSite=lax/);
    assert.match(header, /Path=\//);
    assert.match(header, new RegExp(`Max-Age=${SESSION_MAX_AGE_SECONDS}`));
  });

  test("development omits Secure so local http still stores the cookie", () => {
    usePassword("clave", "development");
    assert.equal(sessionCookieOptions().secure, false);
    const res = NextResponse.json({ ok: true });
    attachSessionCookie(res, sessionToken());
    const header = res.headers.getSetCookie().join("\n");
    assert.doesNotMatch(header, /Secure/);
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=lax/);
  });

  test("clearing the cookie expires it and keeps the production Secure flag", () => {
    usePassword("clave", "production");
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    const header = res.headers.getSetCookie().join("\n");
    assert.match(header, new RegExp(`^${DUO_COOKIE}=;`));
    assert.match(header, /Max-Age=0/);
    assert.match(header, /Expires=Thu, 01 Jan 1970/);
    assert.match(header, /Secure/);
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=lax/);
    assert.match(header, /Path=\//);
  });
});
