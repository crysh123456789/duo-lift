import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  DUO_COOKIE,
  attachSessionCookie,
  clearSessionCookie,
  duoPassword,
  isValidSession,
  sessionToken,
} from "@/lib/duo-lock";

export async function GET() {
  const jar = await cookies();
  const configured = Boolean(duoPassword());
  return NextResponse.json({
    ok: configured ? isValidSession(jar.get(DUO_COOKIE)?.value) : true,
    configured,
  });
}

export async function POST(request: Request) {
  const expected = duoPassword();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "Falta configurar la clave del dúo en el servidor." },
      { status: 503 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (String(body.password ?? "") !== expected) {
    return NextResponse.json({ ok: false, error: "Clave incorrecta." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  attachSessionCookie(res, sessionToken());
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
