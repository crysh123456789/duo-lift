"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/page-title";
import { Button, Field, Panel } from "@/components/ui";
import { LEGACY_HISTORIES, type HistoryChoice } from "@/lib/auth/constants";
import { claimErrorMessage, claimRpcMessage } from "@/lib/auth/errors";
import { applyAccountLocally, type AuthLike } from "@/lib/auth/enter";
import { bumpAuthEpoch, setAuthPhase } from "@/lib/auth/phase";
import { profileFromAuthUser } from "@/lib/auth/profile";
import { attachClaimedHistory } from "@/lib/auth/scope";
import { useGymStore } from "@/lib/store";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { snapshotFromState } from "@/lib/sync/snapshot";

export default function ClaimPage() {
  const router = useRouter();
  const [open, setOpen] = useState<string[] | null>(null);
  const [user, setUser] = useState<AuthLike | null>(null);
  const [pending, setPending] = useState<HistoryChoice | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!alive) return;
      if (!data.user) return;
      setUser(data.user);
      const { data: status, error: statusError } = await supabase.rpc("legacy_history_status");
      if (!alive) return;
      if (statusError) {
        setError(claimErrorMessage(statusError));
        return;
      }
      const body = (status ?? {}) as { open?: unknown };
      setOpen(Array.isArray(body.open) ? body.open.filter((item) => typeof item === "string") : []);
    });
    return () => {
      alive = false;
    };
  }, []);

  const choices = LEGACY_HISTORIES.filter((row) => open?.includes(row.key));

  async function confirm() {
    if (!pending || !user) return;
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setError("Falta la configuración de la cuenta.");
      return;
    }
    setBusy(true);
    setError("");
    bumpAuthEpoch();
    const result =
      pending === "clean"
        ? await supabase.rpc("decline_legacy_history")
        : await supabase.rpc("claim_legacy_history", {
            p_key: pending,
            p_code: code.trim() || null,
          });
    const failure = claimRpcMessage(result);
    if (failure) {
      setBusy(false);
      setError(failure);
      return;
    }
    const profile = profileFromAuthUser(user);
    const base = snapshotFromState(useGymStore.getState());
    const next = attachClaimedHistory(base, profile, pending === "clean" ? null : pending);
    applyAccountLocally(profile, next);
    setAuthPhase("in");
    setBusy(false);
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4">
      <PageTitle title="Traer historial · Duo Lift" />
      <Panel className="w-full max-w-sm space-y-4 p-5">
        <div>
          <p className="font-mono text-xs tracking-[0.28em] text-accent uppercase">Duo Lift</p>
          <h1 className="mt-2 text-2xl font-medium tracking-tight">¿Traer tu historial?</h1>
          <p className="mt-2 text-sm text-muted">Solo se puede una vez; no se puede deshacer.</p>
        </div>
        {open == null ? <p className="text-sm text-muted">Revisando…</p> : null}
        {pending == null ? (
          <div className="space-y-2">
            {choices.map((choice) => (
              <Button key={choice.key} className="w-full" onClick={() => setPending(choice.key)}>
                {choice.label}
              </Button>
            ))}
            <Button variant="primary" className="w-full" onClick={() => setPending("clean")} disabled={open == null}>
              Empezar limpio
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              {pending === "clean"
                ? "Empezar limpio."
                : (LEGACY_HISTORIES.find((row) => row.key === pending)?.label ?? "Ese historial")}
              . Solo se puede una vez; no se puede deshacer.
            </p>
            {pending !== "clean" ? (
              <Field label="Código de un solo uso">
                <input
                  type="password"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
                />
                <span className="mt-1 block text-xs text-muted">
                  Obligatorio. Caduca a las 24 horas. Vacío cuenta como un intento.
                </span>
              </Field>
            ) : null}
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Button variant="primary" className="w-full" disabled={busy} onClick={() => void confirm()}>
              {busy ? "Guardando…" : "Confirmar"}
            </Button>
            <Button className="w-full" disabled={busy} onClick={() => setPending(null)}>
              Volver
            </Button>
          </div>
        )}
        {error && pending == null ? <p className="text-sm text-danger">{error}</p> : null}
      </Panel>
    </div>
  );
}
