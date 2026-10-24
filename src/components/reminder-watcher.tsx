"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { dueReminders } from "@/lib/reminders";
import { omitSeedHistory } from "@/lib/seed";
import { useGymStore } from "@/lib/store";

export function ReminderWatcher() {
  const reminders = useGymStore((s) => s.reminders);
  const activeUserId = useGymStore((s) => s.activeUserId);
  const foodDays = useGymStore((s) => s.foodDays);
  const workouts = useGymStore((s) => s.workouts);
  const markReminderFired = useGymStore((s) => s.markReminderFired);
  const [banner, setBanner] = useState<(ReturnType<typeof dueReminders>)[0] | null>(null);
  const notified = useRef(new Set<string>());

  useEffect(() => {
    if (!reminders?.enabled) return;

    function tick() {
      const state = useGymStore.getState();
      const due = dueReminders({
        reminders: state.reminders,
        userId: state.activeUserId,
        foodDays: state.foodDays ?? [],
        workouts: omitSeedHistory(state).workouts ?? [],
      });
      setBanner(due[0] ?? null);
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      for (const item of due) {
        if (notified.current.has(item.key)) continue;
        notified.current.add(item.key);
        new Notification(item.title, { body: item.body, tag: item.key });
      }
    }

    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [reminders, activeUserId, foodDays, workouts]);

  if (!reminders?.enabled || !banner) return null;

  return (
    <div className="border-b border-accent/40 bg-accent/10 px-4 py-2 text-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 md:pl-52">
        <p>
          <span className="font-medium">{banner.title}.</span> {banner.body}
        </p>
        <div className="flex shrink-0 gap-2">
          <Link href={banner.href} className="text-accent">
            Ir
          </Link>
          <button
            type="button"
            className="text-muted"
            onClick={() => {
              markReminderFired(banner.key);
              setBanner(null);
            }}
          >
            Luego
          </button>
        </div>
      </div>
    </div>
  );
}
