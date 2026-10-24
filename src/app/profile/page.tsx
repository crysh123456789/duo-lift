"use client";

import { useRouter } from "next/navigation";
import { ReminderSettings } from "@/components/reminder-settings";
import { PageTitle } from "@/components/page-title";
import { BodyWeightField } from "@/components/body-weight-field";
import { Button, Field, NumberField, Panel } from "@/components/ui";
import { bumpAuthEpoch, setAuthPhase } from "@/lib/auth/phase";
import { bestWeight, exerciseByName } from "@/lib/metrics";
import { diaryProteinGoal, manualProteinGoal, weightProteinSuggestion } from "@/lib/nutrition";
import { personName } from "@/lib/people";
import { setDuoUnlocked } from "@/lib/session-flag";
import { useGymStore } from "@/lib/store";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { setSyncUserId } from "@/lib/sync/session-user";
import { getSyncPhase } from "@/lib/sync/status";

function WeightProteinLine({
  weightKg,
  proteinTargetG,
}: {
  weightKg: number | null;
  proteinTargetG?: number | null;
}) {
  const driven = weightProteinSuggestion(weightKg);
  const manual = manualProteinGoal({ proteinTargetG });
  const shown = diaryProteinGoal({ weightKg, proteinTargetG });
  if (shown == null) return null;
  if (manual != null && driven != null && manual !== driven) {
    return (
      <p className="text-xs text-muted">
        Meta manual: {manual} g. Este peso marca {driven} g.
      </p>
    );
  }
  return <p className="text-xs text-muted">Meta de proteína: {shown} g (1,8 g/kg).</p>;
}

export default function ProfilePage() {
  const router = useRouter();
  const data = useGymStore();
  const updateUser = useGymStore((s) => s.updateUser);
  const me = data.users.find((u) => u.id === data.activeUserId);
  const name = personName(me);

  if (!me) return null;

  const zancadas = exerciseByName(data, "Zancadas dobles");
  const hatch = exerciseByName(data, "Cuclillas Hack");
  const banca = exerciseByName(data, "Press banca");

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <PageTitle title={name ? `Perfil · ${name}` : "Perfil"} />
      <div>
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Perfil</p>
        <h1 className="text-3xl font-medium tracking-tight">{name || "Tu perfil"}</h1>
        <p className="text-sm text-muted">Cuerpo y alertas. El diario de comida está en Diario.</p>
      </div>

      <Panel className="grid grid-cols-3 gap-3 p-4">
        <div>
          <p className="font-mono text-2xl tabular-nums">
            {zancadas ? (bestWeight(data, me.id, zancadas.id) ?? "—") : "—"}
          </p>
          <p className="text-xs text-muted">kg zancadas</p>
        </div>
        <div>
          <p className="font-mono text-2xl tabular-nums">
            {hatch ? (bestWeight(data, me.id, hatch.id) ?? "—") : "—"}
          </p>
          <p className="text-xs text-muted">kg hack</p>
        </div>
        <div>
          <p className="font-mono text-2xl tabular-nums">
            {banca ? (bestWeight(data, me.id, banca.id) ?? "—") : "—"}
          </p>
          <p className="text-xs text-muted">kg banca</p>
        </div>
      </Panel>

      <Panel className="space-y-3 p-4">
        <p className="text-xs uppercase tracking-wider text-muted">Nombre</p>
        <p className="text-sm text-muted">Así apareces en tu bitácora.</p>
        <Field label="Nombre">
          <input
            value={me.displayName}
            placeholder="Nombre"
            onChange={(e) => updateUser(me.id, { displayName: e.target.value })}
            className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estatura (cm)">
            <input
              inputMode="decimal"
              value={me.heightCm ?? ""}
              onChange={(e) => {
                if (!e.target.value) {
                  updateUser(me.id, { heightCm: null });
                  return;
                }
                const value = Number(e.target.value);
                if (Number.isFinite(value)) updateUser(me.id, { heightCm: value });
              }}
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 font-mono outline-none focus:border-accent"
            />
          </Field>
          <BodyWeightField
            weightKg={me.weightKg}
            onWeightKg={(weightKg) => updateUser(me.id, { weightKg })}
          />
        </div>
        <WeightProteinLine weightKg={me.weightKg} proteinTargetG={me.proteinTargetG} />
        <p className="text-xs uppercase tracking-wider text-muted">Metas del diario</p>
        <p className="text-sm text-muted">
          La proteína sale de este peso, 1,8 g por kilo, mientras no escribas una meta a mano. Las calorías siguen a mano. Si no hay ni peso ni meta, el diario muestra P x/—.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Proteína (g/día)"
            value={me.proteinTargetG ?? null}
            onChange={(proteinTargetG) => updateUser(me.id, { proteinTargetG })}
          />
          <NumberField
            label="Calorías (kcal/día)"
            value={me.kcalTarget ?? null}
            onChange={(kcalTarget) => updateUser(me.id, { kcalTarget })}
          />
        </div>
      </Panel>

      <ReminderSettings />

      <Button
        className="w-full"
        onClick={async () => {
          const phase = getSyncPhase();
          if (
            (phase === "syncing" || phase === "error") &&
            !window.confirm(
              "Hay cambios que todavía no están en la nube. Si sales, siguen en este teléfono. ¿Cerrar sesión?",
            )
          ) {
            return;
          }
          const supabase = createBrowserSupabaseClient();
          if (supabase) await supabase.auth.signOut();
          await fetch("/api/session", { method: "DELETE" });
          bumpAuthEpoch();
          setSyncUserId(null);
          setDuoUnlocked(false);
          setAuthPhase("anon");
          router.replace("/login");
          router.refresh();
        }}
      >
        Cerrar sesión
      </Button>
    </div>
  );
}
