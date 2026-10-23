"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SessionDateField } from "@/components/session-date-field";
import { Button, Panel } from "@/components/ui";
import {
  CTA_CHANGE_DATE,
  CTA_CLOSE,
  CTA_FOLLOW,
  DATE_UPDATED,
  UNCLOSED_TITLE,
  sessionStamp,
  unclosedBody,
} from "@/lib/session-date";
import { useGymStore } from "@/lib/store";
import type { Workout } from "@/lib/types";

export function UnclosedSessionCard({
  workout,
  onDateUpdated,
}: {
  workout: Workout;
  onDateUpdated?: () => void;
}) {
  const router = useRouter();
  const setWorkoutDate = useGymStore((s) => s.setWorkoutDate);
  const abandonWorkout = useGymStore((s) => s.abandonWorkout);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const stamp = sessionStamp(workout.startedAt);

  return (
    <Panel className="space-y-3 p-4">
      <div>
        <h2 className="text-lg font-medium">{UNCLOSED_TITLE}</h2>
        <p className="mt-1 text-sm">{unclosedBody(workout.title, workout.startedAt)}</p>
      </div>
      {editing ? (
        <SessionDateField
          value={stamp}
          notice={notice}
          onChange={(next) => {
            if (!setWorkoutDate(workout.id, next)) return;
            setNotice(DATE_UPDATED);
            onDateUpdated?.();
          }}
        />
      ) : null}
      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          className="min-h-12 w-full"
          onClick={() => router.push(`/workout/new?seguir=${workout.id}`)}
        >
          {CTA_FOLLOW}
        </Button>
        <Button className="min-h-12 w-full" onClick={() => setEditing(true)}>
          {CTA_CHANGE_DATE}
        </Button>
        <Button variant="danger" className="min-h-12 w-full" onClick={() => abandonWorkout(workout.id)}>
          {CTA_CLOSE}
        </Button>
      </div>
    </Panel>
  );
}
