import { createHmac, timingSafeEqual } from "crypto";

export const DUO_COOKIE = "duo_session";

export function duoPassword(): string {
  return process.env.DUO_LIFT_PASSWORD || (process.env.NODE_ENV === "development" ? "duolift" : "");
}

export function sessionToken(password = duoPassword()): string {
  if (!password) return "";
  return createHmac("sha256", password).update("duo-lift").digest("hex");
}

export function isValidSession(cookie: string | undefined): boolean {
  const expected = sessionToken();
  if (!expected || !cookie) return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
