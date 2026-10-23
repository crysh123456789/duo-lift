import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthScreen, isGuestOnlyAuthScreen } from "@/lib/auth/paths";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/public-env";

const PUBLIC_FILE = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$/;

function copyCookies(from: NextResponse, to: NextResponse) {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
  return to;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || PUBLIC_FILE.test(pathname)) return NextResponse.next();

  const url = supabaseUrl();
  const key = supabasePublishableKey();
  const authPage = isAuthScreen(pathname);
  const guestOnly = isGuestOnlyAuthScreen(pathname);
  const api = pathname.startsWith("/api/");

  if (!url || !key) {
    if (authPage || api) return NextResponse.next();
    const login = new URL("/login", request.url);
    login.searchParams.set("from", pathname);
    return NextResponse.redirect(login);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user && !authPage && !api) {
    const login = new URL("/login", request.url);
    login.searchParams.set("from", pathname);
    return copyCookies(response, NextResponse.redirect(login));
  }

  if (user && guestOnly) {
    return copyCookies(response, NextResponse.redirect(new URL("/", request.url)));
  }

  return response;
}
