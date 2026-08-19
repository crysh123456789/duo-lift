"use client";

import { NutritionDiary } from "@/components/nutrition-diary";
import { ReminderSettings } from "@/components/reminder-settings";
import { Field, Panel } from "@/components/ui";
import { bestWeight, exerciseByName } from "@/lib/metrics";
import { useGymStore } from "@/lib/store";

export default function ProfilePage() {
  const data = useGymStore();
  const updateUser = useGymStore((s) => s.updateUser);
  const me = data.users.find((u) => u.id === data.activeUserId);

  if (!me) return null;

  const zancadas = exerciseByName(data, "Zancadas dobles");
  const hatch = exerciseByName(data, "Cuclillas Hack");
  const banca = exerciseByName(data, "Press banca");

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Perfil</p>
        <h1 className="text-3xl font-medium tracking-tight">{me.displayName}</h1>
        <p className="text-sm text-muted">
          Cambia de persona arriba para registrar o reaccionar como el otro.
        </p>
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

      <ReminderSettings />

      <NutritionDiary />

      <Panel className="space-y-3 p-4">
        {data.users.map((user, i) => (
          <Field key={user.id} label={i === 0 ? "Perfil 1" : "Perfil 2"}>
            <input
              value={user.displayName}
              onChange={(e) => updateUser(user.id, { displayName: e.target.value })}
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
            />
          </Field>
        ))}
      </Panel>
    </div>
  );
}
