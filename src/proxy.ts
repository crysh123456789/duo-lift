import { NextRequest, NextResponse } from "next/server";
import { DUO_COOKIE, clearSessionCookie, duoPassword, isValidSession } from "@/lib/duo-lock";

const PUBLIC = [/^\/login$/, /^\/api\/session$/, /^\/manifest\.webmanifest$/, /^\/icon\.svg$/];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname.startsWith("/api/")) return NextResponse.next();
  // No shared password configured: keep the app open (dev fallback lives in duoPassword()).
  if (!duoPassword()) return NextResponse.next();

  const cookie = request.cookies.get(DUO_COOKIE)?.value;
  if (isValidSession(cookie)) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("from", pathname);
  const res = NextResponse.redirect(login);
  if (cookie) clearSessionCookie(res);
  return res;
}
