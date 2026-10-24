"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { PageTitle } from "@/components/page-title";
import { BodyWeightField } from "@/components/body-weight-field";
import { Button, Field, Panel } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/constants";
import { authErrorMessage } from "@/lib/auth/errors";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

function optionalHeight(raw: string): number | null | undefined {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  if (!/^\d+(\.\d)?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 50 || value > 272) return undefined;
  return value;
}

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [height, setHeight] = useState("");
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [weightError, setWeightError] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError("La contraseña es demasiado corta. Mínimo 8 caracteres.");
      return;
    }
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setError("Falta la configuración de la cuenta.");
      return;
    }
    if (weightError) {
      setError(weightError);
      return;
    }
    const heightCm = optionalHeight(height);
    if (heightCm === undefined) {
      setError("La estatura debe estar entre 50 y 272 cm, con máximo un decimal.");
      return;
    }
    setBusy(true);
    const { data, error: signError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          display_name: name.trim(),
          height_cm: heightCm,
          weight_kg: weightKg,
        },
      },
    });
    if (signError) {
      setBusy(false);
      setError(authErrorMessage(signError, "signup"));
      return;
    }
    if (!data.session || !data.user) {
      setBusy(false);
      setNotice("Revisa tu correo para confirmar la cuenta. Después podrás entrar.");
      return;
    }
    setBusy(false);
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-8">
      <PageTitle title="Crear cuenta · Duo Lift" />
      <Panel className="w-full max-w-sm space-y-4 p-5">
        <div>
          <p className="font-mono text-xs tracking-[0.28em] text-accent uppercase">Duo Lift</p>
          <h1 className="mt-2 text-2xl font-medium tracking-tight">Crear cuenta</h1>
          <p className="mt-2 text-sm text-muted">Nombre, correo y contraseña. El resto puede esperar.</p>
        </div>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <Field label="Nombre">
            <input
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
            />
          </Field>
          <Field label="Correo">
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
            />
          </Field>
          <Field label="Contraseña">
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
            />
            <span className="mt-1 block text-xs text-muted">Mínimo 8 caracteres.</span>
          </Field>
          <details className="rounded-xl border border-line px-3 py-2">
            <summary className="cursor-pointer py-2 text-sm text-muted">Más datos (opcional)</summary>
            <div className="grid grid-cols-2 gap-3 pb-2">
              <Field label="Altura (cm)">
                <input
                  inputMode="decimal"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 font-mono outline-none focus:border-accent"
                />
              </Field>
              <BodyWeightField weightKg={weightKg} onWeightKg={setWeightKg} onInvalid={setWeightError} />
            </div>
          </details>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {notice ? <p className="text-sm text-muted">{notice}</p> : null}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={busy || !name.trim() || !email.trim() || !password}
          >
            {busy ? "Creando…" : "Crear cuenta"}
          </Button>
          <p className="text-center text-sm text-muted">
            <Link href="/login" className="text-accent">
              Entrar
            </Link>
          </p>
        </form>
      </Panel>
    </div>
  );
}
