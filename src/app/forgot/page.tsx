"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PageTitle } from "@/components/page-title";
import { Button, Field, Panel } from "@/components/ui";
import {
  EMAIL_RATE_LIMIT_MESSAGE,
  FORGOT_SUCCESS_MESSAGE,
  forgotOutcome,
} from "@/lib/auth/errors";
import { PASSWORD_RECOVERY_REDIRECT_TO } from "@/lib/auth/recovery";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const inputClass = "h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = window.setTimeout(() => setSecondsLeft((current) => (current <= 1 ? 0 : current - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [secondsLeft]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (secondsLeft > 0) return;
    setError("");
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setError("Falta la configuración de la cuenta.");
      return;
    }
    setBusy(true);
    let resetError: { message?: string; code?: string; status?: number } | null = null;
    try {
      const result = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: PASSWORD_RECOVERY_REDIRECT_TO,
      });
      resetError = result.error;
    } catch {
      setBusy(false);
      setError("No se pudo enviar el enlace.");
      return;
    }
    setBusy(false);
    const outcome = forgotOutcome(resetError);
    if (outcome.ok) {
      setSent(true);
      return;
    }
    if (outcome.cooldownSeconds > 0) {
      setSecondsLeft(outcome.cooldownSeconds);
      setError(EMAIL_RATE_LIMIT_MESSAGE);
      return;
    }
    setSecondsLeft(0);
    setError(outcome.message);
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <PageTitle title="Recuperar contraseña · Duo Lift" />
      <Panel className="w-full max-w-sm space-y-4 p-5">
        <div>
          <p className="font-mono text-xs tracking-[0.28em] text-accent uppercase">Duo Lift</p>
          <h1 className="mt-2 text-2xl font-medium tracking-tight">Recuperar contraseña</h1>
          <p className="mt-2 text-sm text-muted">Escribe el correo de tu cuenta.</p>
        </div>
        {sent ? (
          <div className="space-y-3">
            <p role="status" className="text-sm text-foreground">
              {FORGOT_SUCCESS_MESSAGE}
            </p>
            <Link
              href="/login"
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink"
            >
              Volver a entrar
            </Link>
          </div>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
            <Field label="Correo">
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (secondsLeft === 0) setError("");
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
              disabled={busy || secondsLeft > 0 || !email.trim()}
            >
              {busy ? "Enviando…" : "Enviar enlace"}
            </Button>
            <p className="text-center text-sm text-muted">
              <Link href="/login" className="text-accent">
                Volver a entrar
              </Link>
            </p>
          </form>
        )}
      </Panel>
    </div>
  );
}
