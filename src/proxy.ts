import { NextRequest, NextResponse } from "next/server";
import { DUO_COOKIE, duoPassword } from "@/lib/duo-lock";

const PUBLIC = [/^\/login$/, /^\/api\/session$/, /^\/manifest\.webmanifest$/, /^\/icon\.svg$/];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname.startsWith("/api/")) return NextResponse.next();
  if (!duoPassword()) return NextResponse.next();

  if (!request.cookies.get(DUO_COOKIE)?.value) {
    const login = new URL("/login", request.url);
    login.searchParams.set("from", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}
