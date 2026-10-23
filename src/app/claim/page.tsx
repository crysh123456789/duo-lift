"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageTitle } from "@/components/page-title";
import { Button, Panel } from "@/components/ui";
import { LEGACY_HISTORIES, isLegacyKey, legacyUserId, type HistoryChoice } from "@/lib/auth/constants";
import { claimErrorMessage } from "@/lib/auth/errors";
import { applyAccountLocally, type AuthLike } from "@/lib/auth/enter";
import { bumpAuthEpoch, setAuthPhase } from "@/lib/auth/phase";
import { profileFromAuthUser } from "@/lib/auth/profile";
import { adoptAccount, rewriteLegacyOwner } from "@/lib/auth/scope";
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
        : await supabase.rpc("claim_legacy_history", { p_key: pending });
    if (result.error) {
      setBusy(false);
      setError(claimErrorMessage(result.error));
      return;
    }
    const profile = profileFromAuthUser(user);
    const base = snapshotFromState(useGymStore.getState());
    const next =
      pending === "clean" || !isLegacyKey(pending)
        ? adoptAccount(base, profile)
        : adoptAccount(rewriteLegacyOwner(base, legacyUserId(pending), user.id), profile);
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
