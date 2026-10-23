/**
 * Retired. Supabase Auth owns the session. The app does not import this module.
 * DUO_LIFT_PASSWORD is no longer checked. Delete that env var after cutover.
 */
import { createHmac, timingSafeEqual } from "crypto";

export const DUO_COOKIE = "duo_session";
/** Browser cookie lifetime and the max age checked again when the token is validated. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const TOKEN_VERSION = "v1";
const FUTURE_SKEW_SECONDS = 60;

export function duoPassword(): string {
  return process.env.DUO_LIFT_PASSWORD || (process.env.NODE_ENV === "development" ? "duolift" : "");
}

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
  expires?: Date;
};

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

type CookieResponse = {
  cookies: {
    set: (name: string, value: string, options: SessionCookieOptions) => void;
  };
};

export function attachSessionCookie(response: CookieResponse, token: string) {
  response.cookies.set(DUO_COOKIE, token, sessionCookieOptions());
}

export function clearSessionCookie(response: CookieResponse) {
  response.cookies.set(DUO_COOKIE, "", { ...sessionCookieOptions(0), expires: new Date(0) });
}

/** `v1.<issuedAtSeconds>.<hmac>`. Invalid after SESSION_MAX_AGE_SECONDS. */
export function sessionToken(
  password = duoPassword(),
  issuedAtSeconds = Math.floor(Date.now() / 1000),
): string {
  if (!password) return "";
  if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds < 0) return "";
  const payload = `${TOKEN_VERSION}.${issuedAtSeconds}`;
  const sig = createHmac("sha256", password).update(`duo-lift.${payload}`).digest("base64url");
  return `${payload}.${sig}`;
}

export function isValidSession(cookie: string | undefined, nowMs = Date.now()): boolean {
  const password = duoPassword();
  if (!password || !cookie || cookie.length > 128) return false;
  const parts = cookie.split(".");
  if (parts.length !== 3) return false;
  const [version, issuedRaw, sig] = parts;
  if (version !== TOKEN_VERSION) return false;
  if (!/^(0|[1-9]\d{0,11})$/.test(issuedRaw)) return false;
  const issuedAt = Number(issuedRaw);
  if (!Number.isSafeInteger(issuedAt)) return false;

  const nowSec = Math.floor(nowMs / 1000);
  if (issuedAt > nowSec + FUTURE_SKEW_SECONDS) return false;
  if (nowSec - issuedAt >= SESSION_MAX_AGE_SECONDS) return false;

  const expected = createHmac("sha256", password)
    .update(`duo-lift.${version}.${issuedRaw}`)
    .digest("base64url");
  const actual = Buffer.from(sig);
  const want = Buffer.from(expected);
  if (actual.length !== want.length) return false;
  return timingSafeEqual(actual, want);
}
