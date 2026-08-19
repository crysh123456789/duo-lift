"use client";

import { useRouter } from "next/navigation";
import { ReminderSettings } from "@/components/reminder-settings";
import { PageTitle } from "@/components/page-title";
import { Button, Field, Panel } from "@/components/ui";
import { bestWeight, exerciseByName } from "@/lib/metrics";
import { personName } from "@/lib/people";
import { useGymStore } from "@/lib/store";

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
        <h1 className="text-3xl font-medium tracking-tight">{name || "Identidad del dúo"}</h1>
        <p className="text-sm text-muted">Nombres, cuerpo y alertas. El diario de comida está en Diario.</p>
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
        <p className="text-[11px] uppercase tracking-wider text-muted">Nombres</p>
        <p className="text-sm text-muted">Así aparecen en toda la app.</p>
        {data.users.map((user) => (
          <Field key={user.id} label={personName(user) || "Nombre"}>
            <input
              value={user.displayName}
              placeholder="Nombre"
              onChange={(e) => updateUser(user.id, { displayName: e.target.value })}
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
            />
          </Field>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estatura (cm)">
            <input
              inputMode="decimal"
              value={me.heightCm ?? ""}
              onChange={(e) =>
                updateUser(me.id, { heightCm: e.target.value ? Number(e.target.value) : null })
              }
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 font-mono outline-none focus:border-accent"
            />
          </Field>
          <Field label="Peso (kg)">
            <input
              inputMode="decimal"
              value={me.weightKg ?? ""}
              onChange={(e) =>
                updateUser(me.id, { weightKg: e.target.value ? Number(e.target.value) : null })
              }
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 font-mono outline-none focus:border-accent"
            />
          </Field>
        </div>
      </Panel>

      <ReminderSettings />

      <Button
        className="w-full"
        onClick={async () => {
          await fetch("/api/session", { method: "DELETE" });
          router.replace("/login");
          router.refresh();
        }}
      >
        Cerrar sesión del dúo
      </Button>
    </div>
  );
}
