import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The shared duo password no longer opens a session. */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, configured: false });
  const { data } = await supabase.auth.getUser();
  return NextResponse.json({ ok: Boolean(data.user), configured: true });
}

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "La clave compartida ya no entra. Usa tu correo." },
    { status: 410 },
  );
}

export async function DELETE() {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
