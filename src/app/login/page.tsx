"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { PageTitle } from "@/components/page-title";
import { Button, Field, Panel } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/constants";
import { authErrorMessage } from "@/lib/auth/errors";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError("La contraseña es demasiado corta. Mínimo 8 caracteres.");
      return;
    }
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setError("Falta la configuración de la cuenta.");
      return;
    }
    setBusy(true);
    const { error: signError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (signError) {
      setError(authErrorMessage(signError, "login"));
      return;
    }
    router.replace(params.get("from") || "/");
    router.refresh();
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <PageTitle title="Entrar · Duo Lift" />
      <Panel className="w-full max-w-sm space-y-4 p-5">
        <div>
          <p className="font-mono text-xs tracking-[0.28em] text-accent uppercase">Duo Lift</p>
          <h1 className="mt-2 text-2xl font-medium tracking-tight">Tu cuenta</h1>
          <p className="mt-2 text-sm text-muted">
            Cada persona entra con su correo y ve solo su gym y su diario.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a
            href="#entrar"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink"
          >
            Entrar
          </a>
          <Link
            href="/signup"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium"
          >
            Crear cuenta
          </Link>
        </div>
        <form id="entrar" onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <Field label="Correo">
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
            />
          </Field>
          <Field label="Contraseña">
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
            />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !email.trim() || !password}>
            {busy ? "Entrando…" : "Entrar"}
          </Button>
          <p className="text-center text-sm text-muted">
            <Link href="/signup" className="text-accent">
              Crear cuenta
            </Link>
          </p>
        </form>
      </Panel>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
