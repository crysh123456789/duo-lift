"use client";

import { Button, Panel } from "@/components/ui";
import { TimeField } from "@/components/time-field";
import { MEAL_SLOTS } from "@/lib/nutrition";
import { DEFAULT_REMINDERS, remindersIcs } from "@/lib/reminders";
import { useGymStore } from "@/lib/store";
import type { MealSlot } from "@/lib/types";

export function ReminderSettings() {
  const reminders = useGymStore((s) => s.reminders) ?? DEFAULT_REMINDERS;
  const updateReminders = useGymStore((s) => s.updateReminders);

  async function enable() {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    updateReminders({ enabled: true });
  }

  function setMeal(id: MealSlot, patch: { enabled?: boolean; time?: string }) {
    updateReminders({
      meals: {
        ...reminders.meals,
        [id]: { ...reminders.meals[id], ...patch },
      },
    });
  }

  function downloadIcs() {
    const blob = new Blob([remindersIcs(reminders)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "duo-lift-recordatorios.ics";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel className="space-y-3 p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted">Alertas</p>
      <p className="text-sm text-muted">
        Te recuerdan comer y entrenar. En el navegador suenan si dejas la app abierta. El archivo
        .ics las mete en Google Calendar o el reloj del teléfono.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={reminders.enabled}
          onChange={(e) => {
            if (e.target.checked) void enable();
            else updateReminders({ enabled: false });
          }}
        />
        Activar recordatorios
      </label>
      <div className="space-y-2">
        {MEAL_SLOTS.map((slot) => (
          <div key={slot.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={reminders.meals[slot.id].enabled}
                onChange={(e) => setMeal(slot.id, { enabled: e.target.checked })}
              />
              {slot.label}
            </label>
            <TimeField
              value={reminders.meals[slot.id].time}
              onChange={(time) => setMeal(slot.id, { time })}
            />
          </div>
        ))}
        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reminders.gym.enabled}
              onChange={(e) =>
                updateReminders({ gym: { ...reminders.gym, enabled: e.target.checked } })
              }
            />
            Gym
          </label>
          <TimeField
            value={reminders.gym.time}
            onChange={(time) => updateReminders({ gym: { ...reminders.gym, time } })}
          />
        </div>
      </div>
      <Button className="w-full" onClick={downloadIcs}>
        Descargar para el calendario (.ics)
      </Button>
    </Panel>
  );
}
