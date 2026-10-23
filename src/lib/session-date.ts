import type { GymData, Workout } from "./types";
import { whenLabel } from "./format";
import { todayStamp } from "./nutrition";

export const UNCLOSED_TITLE = "Tienes una sesión sin cerrar";
export const DATE_FIELD_LABEL = "Fecha del entreno";
export const DATE_FIELD_HINT = "Así el historial queda en el día correcto.";
export const DATE_UPDATED = "Fecha actualizada";
export const CTA_FOLLOW = "Seguir";
export const CTA_CHANGE_DATE = "Cambiar fecha";
export const CTA_CLOSE = "Cerrar";

const STAMP = /^\d{4}-\d{2}-\d{2}$/;

export function sessionStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return todayStamp(date);
}

export function isSameSessionDay(iso: string, now = new Date()): boolean {
  return sessionStamp(iso) === todayStamp(now);
}

export function isValidStamp(stamp: string, today = todayStamp()): boolean {
  if (!STAMP.test(stamp)) return false;
  const [year, month, day] = stamp.split("-").map(Number);
  if (!year || !month || !day) return false;
  const probe = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return false;
  }
  return stamp <= today;
}

/** Keep the clock, move the local calendar day. */
export function atLocalStamp(stamp: string, clock: Date): string {
  const [year, month, day] = stamp.split("-").map(Number);
  const next = new Date(clock.getTime());
  next.setFullYear(year, (month ?? 1) - 1, day ?? 1);
  return next.toISOString();
}

export function shiftStartedAt(iso: string, stamp: string, today = todayStamp()): string | null {
  if (!isValidStamp(stamp, today)) return null;
  const prev = new Date(iso);
  const clock = Number.isNaN(prev.getTime()) ? new Date() : prev;
  const next = atLocalStamp(stamp, clock);
  return sessionStamp(next) === stamp ? next : null;
}

export function sessionDateText(iso: string, now = new Date()): string {
  return whenLabel(iso, now);
}

export function unclosedBody(title: string | null | undefined, iso: string, now = new Date()): string {
  const name = title?.trim() || "Entrenamiento";
  return `${name} · ${sessionDateText(iso, now)}`;
}

export function unclosedBadge(iso: string, now = new Date()): string {
  return `Sin cerrar · ${sessionDateText(iso, now)}`;
}

function openFor(workouts: Workout[], userId: string): Workout[] {
  return workouts.filter((workout) => workout.userId === userId && workout.status === "in_progress");
}

export function todayOpenWorkout(workouts: Workout[], userId: string, now = new Date()): Workout | undefined {
  const today = todayStamp(now);
  return openFor(workouts, userId)
    .filter((workout) => sessionStamp(workout.startedAt) === today)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

export function staleOpenWorkouts(workouts: Workout[], userId: string, now = new Date()): Workout[] {
  const today = todayStamp(now);
  return openFor(workouts, userId)
    .filter((workout) => sessionStamp(workout.startedAt) !== today)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function staleOpenWorkout(workouts: Workout[], userId: string, now = new Date()): Workout | undefined {
  return staleOpenWorkouts(workouts, userId, now)[0];
}

/** Reuse an open session only when it is already on this calendar day. */
export function reusableOpenId(workouts: Workout[], userId: string, stamp: string): string | null {
  const match = openFor(workouts, userId)
    .filter((workout) => sessionStamp(workout.startedAt) === stamp)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return match?.id ?? null;
}

export type SplitStartPlan =
  | { action: "reuse"; id: string }
  | { action: "replace-same-day"; id: string }
  | { action: "create" };

/**
 * A session from another day is never reused and never replaced.
 * Switching split only discards an open session dated the same day.
 */
export function planSplitStart(
  workouts: Workout[],
  userId: string,
  stamp: string,
  dayId: string,
  splitIdOf: (workout: Workout) => string | null,
): SplitStartPlan {
  const existingId = reusableOpenId(workouts, userId, stamp);
  if (!existingId) return { action: "create" };
  const existing = workouts.find((workout) => workout.id === existingId);
  if (!existing) return { action: "create" };
  if (splitIdOf(existing) === dayId) return { action: "reuse", id: existingId };
  return { action: "replace-same-day", id: existingId };
}

/**
 * Home button beside the split kicker.
 * An open session from another day is not "Seguir {título}" — the card handles it.
 * Returns null when that card is the only action (no new session for today).
 */
export function homeTrainCta(workouts: Workout[], userId: string, now = new Date()): string | null {
  const today = todayOpenWorkout(workouts, userId, now);
  const stale = staleOpenWorkout(workouts, userId, now);
  if (stale && !today) return null;
  if (!today) return "Entrenar";
  const title = today.title?.trim();
  return title ? `Seguir ${title.toLowerCase()}` : "Seguir sesión";
}

export function omitWorkout(
  data: Pick<GymData, "workouts" | "blocks" | "stations" | "sets">,
  workoutId: string,
): Pick<GymData, "workouts" | "blocks" | "stations" | "sets"> {
  const blockIds = new Set(data.blocks.filter((block) => block.workoutId === workoutId).map((block) => block.id));
  const stationIds = new Set(
    data.stations.filter((station) => blockIds.has(station.blockId)).map((station) => station.id),
  );
  return {
    workouts: data.workouts.filter((workout) => workout.id !== workoutId),
    blocks: data.blocks.filter((block) => block.workoutId !== workoutId),
    stations: data.stations.filter((station) => !blockIds.has(station.blockId)),
    sets: data.sets.filter((set) => !stationIds.has(set.stationId)),
  };
}

/** Freshness for sync. A date edit sets updatedAt so an earlier startedAt still wins. */
export function workoutClock(workout: Pick<Workout, "startedAt" | "endedAt" | "updatedAt">): string {
  return workout.updatedAt || workout.endedAt || workout.startedAt;
}
