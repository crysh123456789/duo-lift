import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DUO_COOKIE, isValidSession } from "@/lib/duo-lock";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { syncGate } from "@/lib/sync/gate";
import { parseSnapshot, parseTombstones, SYNC_ID } from "@/lib/sync/payload";
import { readDuo, requireAdmin, writeDuo } from "@/lib/sync/remote";
import { missingWorkoutIds } from "@/lib/sync/round";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

async function duoAllowed() {
  const gate = syncGate();
  if (!gate.password) return true;
  const jar = await cookies();
  return isValidSession(jar.get(DUO_COOKIE)?.value);
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

/** Flag is on, but URL, service role, or duo password is missing. Do not pretend sync is off. */
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

export async function GET(request: Request) {
  if (!(await duoAllowed())) {
    return json({ ok: false, error: "Sesión del dúo requerida." }, 401);
  }
  const gate = syncGate();
  // Touch the publishable server client so the SSR cookie wiring stays in this route.
  try {
    await createSupabaseServerClient();
  } catch (error) {
    logSyncFailure("publishable client", error);
  }
  if (!gate.flag) return json(disabledBody());
  if (!gate.enabled) return misconfigured();

  const duoId = new URL(request.url).searchParams.get("duoId") ?? "";
  if (!SYNC_ID.test(duoId)) return json({ ...disabledBody(), enabled: true, data: null });

  const admin = requireAdmin();
  if (!admin) return misconfigured();
  try {
    const remote = await readDuo(admin, duoId);
    if (!remote) {
      return json({
        ok: true,
        enabled: true,
        configured: true,
        publishable: gate.publishable,
        remindersFromServer: false,
        data: null,
        tombstones: [],
      });
    }
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
  if (!(await duoAllowed())) {
    return json({ ok: false, error: "Sesión del dúo requerida." }, 401);
  }
  const gate = syncGate();
  if (!gate.flag) return json(disabledBody());
  if (!gate.enabled) return misconfigured();
  const admin = requireAdmin();
  if (!admin) return misconfigured();

  const body = (await request.json().catch(() => null)) as { snapshot?: unknown; tombstones?: unknown } | null;
  const snapshot = parseSnapshot(body?.snapshot);
  if (!snapshot) return json({ ok: false, error: "Snapshot inválido." }, 400);
  const tombstones = parseTombstones(body?.tombstones);

  try {
    await writeDuo(admin, snapshot, tombstones);
    const remote = await readDuo(admin, snapshot.duo.id);
    const missing = remote ? missingWorkoutIds(snapshot, remote.data, tombstones) : snapshot.workouts.map((row) => row.id);
    if (!remote || missing.length > 0) {
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
    });
  } catch (error) {
    logSyncFailure("write", error);
    return json({ ok: false, enabled: true, error: "No se pudo guardar en Supabase." }, 502);
  }
}
