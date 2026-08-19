import type { FoodDay, ReminderSettings, Workout } from "./types";
import { MEAL_SLOTS, todayStamp } from "./nutrition";

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false,
  lastFired: {},
  meals: {
    desayuno: { enabled: true, time: "08:00" },
    mediaManana: { enabled: true, time: "11:00" },
    almuerzo: { enabled: true, time: "13:00" },
    mediaTarde: { enabled: true, time: "16:30" },
    cena: { enabled: true, time: "20:00" },
  },
  gym: { enabled: true, time: "18:00" },
};

export type DueReminder = {
  key: string;
  title: string;
  body: string;
  href: string;
};

function minutesNow(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes();
}

function parseTime(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function dueReminders(opts: {
  reminders: ReminderSettings;
  userId: string;
  foodDays: FoodDay[];
  workouts: Workout[];
  now?: Date;
}): DueReminder[] {
  const { reminders, userId, foodDays, workouts } = opts;
  const now = opts.now ?? new Date();
  const settings = {
    ...DEFAULT_REMINDERS,
    ...reminders,
    meals: { ...DEFAULT_REMINDERS.meals, ...reminders.meals },
    gym: reminders.gym ?? DEFAULT_REMINDERS.gym,
    lastFired: reminders.lastFired ?? {},
  };
  if (!settings.enabled) return [];
  const date = todayStamp(now);
  const nowMin = minutesNow(now);
  const todayFood = foodDays.find((d) => d.userId === userId && d.date === date);
  const trained = workouts.some(
    (w) => w.userId === userId && w.status === "completed" && todayStamp(new Date(w.startedAt)) === date,
  );
  const due: DueReminder[] = [];

  for (const slot of MEAL_SLOTS) {
    const cfg = settings.meals[slot.id];
    if (!cfg?.enabled) continue;
    if (nowMin < parseTime(cfg.time)) continue;
    const key = `${userId}:${date}:${slot.id}`;
    if (settings.lastFired[key]) continue;
    if (todayFood?.meals[slot.id]?.trim()) continue;
    due.push({
      key,
      title: `Hora de ${slot.label.toLowerCase()}`,
      body: `Si ya comiste, anótalo en el diario.`,
      href: "/nutrition",
    });
  }

  if (settings.gym.enabled && nowMin >= parseTime(settings.gym.time) && !trained) {
    const key = `${userId}:${date}:gym`;
    if (!settings.lastFired[key]) {
      due.push({
        key,
        title: "¿Entrenamos hoy?",
        body: "Aún no hay una sesión cerrada. Entra a Entrenar o descarta si es día libre.",
        href: "/workout/new",
      });
    }
  }

  return due;
}

export function remindersIcs(reminders: ReminderSettings) {
  const stamp = (hhmm: string) => hhmm.replace(":", "") + "00";
  const day = todayStamp().replace(/-/g, "");
  const events: string[] = [];
  const rows: { uid: string; title: string; time: string }[] = MEAL_SLOTS.filter(
    (s) => reminders.meals[s.id].enabled,
  ).map((s) => ({
    uid: `duo-lift-${s.id}@duolift.local`,
    title: `${s.label} — registra tu comida (Duo Lift)`,
    time: reminders.meals[s.id].time,
  }));
  if (reminders.gym.enabled) {
    rows.push({
      uid: "duo-lift-gym@duolift.local",
      title: "Entrenar — Duo Lift",
      time: reminders.gym.time,
    });
  }
  for (const row of rows) {
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:${row.uid}`,
        `DTSTART;TZID=America/Bogota:${day}T${stamp(row.time)}`,
        `DTEND;TZID=America/Bogota:${day}T${stamp(row.time)}`,
        "RRULE:FREQ=DAILY",
        `SUMMARY:${row.title}`,
        "BEGIN:VALARM",
        "TRIGGER:PT0S",
        "ACTION:DISPLAY",
        `DESCRIPTION:${row.title}`,
        "END:VALARM",
        "END:VEVENT",
      ].join("\r\n"),
    );
  }
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Duo Lift//Reminders//ES",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
}
