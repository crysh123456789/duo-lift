"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { Button, Field, Panel } from "@/components/ui";
import { PageTitle } from "@/components/page-title";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "No se pudo entrar.");
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
          <h1 className="mt-2 text-2xl font-medium tracking-tight">Bitácora privada</h1>
          <p className="mt-2 text-sm text-muted">
            Solo ustedes dos registran comidas, peso y cargas. Clave compartida del dúo.
          </p>
        </div>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <Field label="Clave del dúo">
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
            />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !password.trim()}>
            {busy ? "Entrando…" : "Entrar"}
          </Button>
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
