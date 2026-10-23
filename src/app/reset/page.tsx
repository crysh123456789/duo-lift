"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PageTitle } from "@/components/page-title";
import { Button, Field, Panel } from "@/components/ui";
import {
  RECOVERY_LINK_FAILED,
  RECOVERY_LINK_INVALID,
  passwordUpdateMessage,
  validateNewPassword,
} from "@/lib/auth/errors";
import {
  classifyRecoveryArrival,
  openRecoverySession,
  recoveryAttemptKey,
  type RecoveryArrival,
  type RecoveryOpen,
} from "@/lib/auth/recovery";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { isPublishableConfigured } from "@/lib/supabase/public-env";

const inputClass = "h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent";

const attempts = new Map<string, Promise<RecoveryOpen>>();

function establishRecovery(supabase: SupabaseClient, arrival: RecoveryArrival) {
  const key = recoveryAttemptKey(arrival);
  const existing = attempts.get(key);
  if (existing) return existing;
  const promise = openRecoverySession(supabase, arrival, () => window.location.href).catch(
    () => "failed" as const,
  );
  attempts.set(key, promise);
  return promise;
}

function clearRecoveryUrl() {
  window.history.replaceState(window.history.state, "", "/reset");
}

export default function ResetPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"checking" | "unconfigured" | "invalid" | "failed" | "form">(() =>
    isPublishableConfigured() ? "checking" : "unconfigured",
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const arrival = classifyRecoveryArrival(window.location.href);
    if (!isPublishableConfigured()) {
      if (arrival.kind !== "none") clearRecoveryUrl();
      return;
    }
    const supabase = createBrowserSupabaseClient();
    if (!supabase) return;
    void establishRecovery(supabase, arrival).then((outcome) => {
      if (outcome !== "failed") clearRecoveryUrl();
      if (!alive) return;
      if (outcome === "ready") setPhase("form");
      else if (outcome === "failed") setPhase("failed");
      else setPhase("invalid");
    });
    return () => {
      alive = false;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const local = validateNewPassword(password, confirm);
    if (local) {
      setError(local);
      return;
    }
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setError("Falta la configuración de la cuenta.");
      return;
    }
    setBusy(true);
    let updateError: { message?: string; code?: string; status?: number } | null = null;
    try {
      const result = await supabase.auth.updateUser({ password });
      updateError = result.error;
    } catch {
      setBusy(false);
      setError("No se pudo guardar la contraseña.");
      return;
    }
    setBusy(false);
    if (updateError) {
      setError(passwordUpdateMessage(updateError));
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <PageTitle title="Nueva contraseña · Duo Lift" />
      <Panel className="w-full max-w-sm space-y-4 p-5">
        <div>
          <p className="font-mono text-xs tracking-[0.28em] text-accent uppercase">Duo Lift</p>
          <h1 className="mt-2 text-2xl font-medium tracking-tight">Nueva contraseña</h1>
          {phase === "form" ? (
            <p className="mt-2 text-sm text-muted">Elige una contraseña de al menos 8 caracteres.</p>
          ) : null}
        </div>
        {phase === "checking" ? <p className="text-sm text-muted">Comprobando el enlace…</p> : null}
        {phase === "unconfigured" ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-danger">
              Falta la configuración de la cuenta.
            </p>
            <BackToLogin />
          </div>
        ) : null}
        {phase === "invalid" ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-danger">
              {RECOVERY_LINK_INVALID}
            </p>
            <Link
              href="/forgot"
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink"
            >
              Pedir un enlace
            </Link>
            <BackToLogin />
          </div>
        ) : null}
        {phase === "failed" ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-danger">
              {RECOVERY_LINK_FAILED}
            </p>
            <Button type="button" variant="primary" className="w-full" onClick={() => window.location.reload()}>
              Reintentar
            </Button>
            <BackToLogin />
          </div>
        ) : null}
        {phase === "form" ? (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
            <Field label="Contraseña">
              <input
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                className={inputClass}
              />
              <span className="mt-1 block text-xs text-muted">Mínimo 8 caracteres.</span>
            </Field>
            <Field label="Confirmar">
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError("");
                }}
                className={inputClass}
              />
            </Field>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={busy || !password || !confirm}
            >
              {busy ? "Guardando…" : "Guardar y entrar"}
            </Button>
            <BackToLogin />
          </form>
        ) : null}
      </Panel>
    </div>
  );
}

function BackToLogin() {
  return (
    <p className="text-center text-sm text-muted">
      <Link href="/login" className="text-accent">
        Volver a entrar
      </Link>
    </p>
  );
}
