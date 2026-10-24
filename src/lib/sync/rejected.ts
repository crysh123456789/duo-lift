/** Clear errors raised by sync_apply before it writes. */
export const FOOD_DAY_LIMIT_ERRORS = [
  "too many food_days",
  "food_days payload too large",
  "food_days must be an array",
] as const;

export const TARGET_LIMIT_ERRORS = [
  "protein_target_g must be an integer",
  "protein_target_g out of range",
  "kcal_target must be an integer",
  "kcal_target out of range",
  "weight_kg must have at most 1 decimal",
  "weight_kg out of range",
  "height_cm must be numeric",
  "height_cm must have at most 1 decimal",
  "height_cm out of range",
  "targets_updated_at must be a timestamp",
  "targets_updated_at is more than 5 minutes in the future",
  "profile_updated_at must be a timestamp",
  "profile_updated_at is more than 5 minutes in the future",
] as const;

export const SYNC_APPLY_INPUT_ERRORS = [...FOOD_DAY_LIMIT_ERRORS, ...TARGET_LIMIT_ERRORS] as const;

export type FoodDayRejectReason = "other_user" | "foreign_id";

export type RejectedFoodDay = {
  id: string;
  date: string | null;
  reason: FoodDayRejectReason;
};

function rowsOf(source: unknown): unknown[] {
  if (!source || typeof source !== "object") return [];
  const body = source as { rejected?: unknown; food_days?: unknown };
  const rejected = body.rejected;
  if (rejected && typeof rejected === "object") {
    const foodDays = (rejected as { food_days?: unknown }).food_days;
    if (Array.isArray(foodDays)) return foodDays;
  }
  if (Array.isArray(body.food_days)) return body.food_days;
  return [];
}

/** Food days sync_apply refused because the id belongs to someone else. */
export function rejectedFoodDays(source: unknown): RejectedFoodDay[] {
  const out: RejectedFoodDay[] = [];
  for (const row of rowsOf(source)) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    const reason = (row as { reason?: unknown }).reason;
    const date = (row as { date?: unknown }).date;
    if (typeof id !== "string" || id.length === 0) continue;
    if (reason !== "other_user" && reason !== "foreign_id") continue;
    out.push({
      id,
      date: typeof date === "string" ? date : null,
      reason,
    });
  }
  return out;
}

/** Returns the stable limit phrase, or null when the failure is something else. */
export function clearFoodDayLimitError(message: string): string | null {
  return FOOD_DAY_LIMIT_ERRORS.find((item) => message.includes(item)) ?? null;
}

/** Food-day limits and nutrition target limits, in that order. */
export function clearSyncApplyError(message: string): string | null {
  return SYNC_APPLY_INPUT_ERRORS.find((item) => message.includes(item)) ?? null;
}
