import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { syncGate } from "@/lib/sync/gate";
import { parseSnapshot, parseTombstones } from "@/lib/sync/payload";
import { readOwn, writeOwn } from "@/lib/sync/remote";
import { clearSyncApplyError } from "@/lib/sync/rejected";
import { missingWorkoutIds } from "@/lib/sync/round";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function disabledBody() {
  const gate = syncGate();
  return {
    ok: true,
    enabled: false,
    configured: gate.configured,
    publishable: gate.publishable,
    remindersFromServer: false,
    data: null,
    tombstones: [],
  };
}

function logSyncFailure(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : "unknown";
  console.error(`[sync] ${action} failed: ${message}`);
}

function misconfigured() {
  return json(
    {
      ok: false,
      enabled: true,
      error: "Falta la configuración de sync en el servidor.",
      data: null,
      tombstones: [],
    },
    503,
  );
}

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, userId: data.user.id };
}

export async function GET() {
  const session = await requireUser();
  if (!session) return json({ ok: false, error: "Sesión requerida." }, 401);
  const gate = syncGate();
  if (!gate.flag) return json(disabledBody());
  if (!gate.enabled) return misconfigured();

  try {
    const remote = await readOwn(session.supabase, session.userId);
    return json({
      ok: true,
      enabled: true,
      configured: true,
      publishable: gate.publishable,
      remindersFromServer: remote.remindersFromServer,
      data: remote.data,
      tombstones: remote.tombstones,
    });
  } catch (error) {
    logSyncFailure("read", error);
    return json({ ok: false, enabled: true, error: "No se pudo leer Supabase." }, 502);
  }
}

export async function PUT(request: Request) {
  const session = await requireUser();
  if (!session) return json({ ok: false, error: "Sesión requerida." }, 401);
  const gate = syncGate();
  if (!gate.flag) return json(disabledBody());
  if (!gate.enabled) return misconfigured();

  const body = (await request.json().catch(() => null)) as { snapshot?: unknown; tombstones?: unknown } | null;
  const snapshot = parseSnapshot(body?.snapshot);
  if (!snapshot) return json({ ok: false, error: "Snapshot inválido." }, 400);
  const tombstones = parseTombstones(body?.tombstones);
  const foreignWorkout = snapshot.workouts.some((row) => row.userId !== session.userId);
  const foreignLoad = Object.keys(snapshot.workingLoads).some(
    (key) => !key.startsWith(`${session.userId}:`),
  );
  if (foreignWorkout || foreignLoad) {
    return json({ ok: false, error: "El snapshot incluye a otra persona." }, 400);
  }

  try {
    const written = await writeOwn(session.supabase, snapshot, tombstones);
    const remote = await readOwn(session.supabase, session.userId);
    const missing = missingWorkoutIds(snapshot, remote.data, tombstones);
    if (missing.length > 0) {
      console.error(`[sync] write incomplete: ${missing.length} workouts were not stored`);
      return json({ ok: false, enabled: true, error: "No se pudo confirmar el historial." }, 502);
    }
    return json({
      ok: true,
      enabled: true,
      configured: true,
      publishable: gate.publishable,
      remindersFromServer: remote.remindersFromServer,
      data: remote.data,
      tombstones: remote.tombstones,
      rejected: written.rejected,
    });
  } catch (error) {
    logSyncFailure("write", error);
    const message = error instanceof Error ? error.message : "";
    const clear = clearSyncApplyError(message);
    if (clear) return json({ ok: false, enabled: true, error: clear }, 400);
    return json({ ok: false, enabled: true, error: "No se pudo guardar en Supabase." }, 502);
  }
}
