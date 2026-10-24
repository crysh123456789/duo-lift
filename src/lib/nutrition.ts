import { nid } from "./ids";
import type { FoodDay, MealEntry, MealItem, MealLog, MealSlot, User } from "./types";

export const MEAL_SLOTS: { id: MealSlot; label: string }[] = [
  { id: "desayuno", label: "Desayuno" },
  { id: "mediaManana", label: "Media mañana" },
  { id: "almuerzo", label: "Almuerzo" },
  { id: "mediaTarde", label: "Media tarde" },
  { id: "cena", label: "Cena" },
];

export const PROTEIN_TODAY_LABEL = "Proteína hoy";
export const DIARY_SAVED = "Diario actualizado";
export const NO_TIME_LABEL = "Sin hora";
export const EMPTY_ITEMS_COPY = "Aún no hay alimentos — añade el primero";
export const SAVED_NOTE_LABEL = "Nota guardada";
export const OPTIONAL_NOTE_LABEL = "Nota opcional";
export const QUICK_ITEM_LABEL = "+ Ítem rápido";

const TIME = /^(\d{1,2}):(\d{2})$/;

export function emptyMeal(): MealEntry {
  return { time: null, items: [], note: "" };
}

export function emptyMeals(): MealLog {
  return {
    desayuno: emptyMeal(),
    mediaManana: emptyMeal(),
    almuerzo: emptyMeal(),
    mediaTarde: emptyMeal(),
    cena: emptyMeal(),
  };
}

export function blankMealItem(id: string): MealItem {
  return { id, name: "", grams: null, proteinG: null, carbsG: null, fatG: null };
}

export function todayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function shiftStamp(stamp: string, delta: number): string {
  const [year, month, day] = stamp.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
  date.setDate(date.getDate() + delta);
  return todayStamp(date);
}

export function bmi(heightCm: number, weightKg: number) {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export function proteinTargetG(weightKg: number) {
  return Math.round(weightKg * 1.8);
}

/** Bounds stored by sync_apply. Out of range is treated as unset on read. */
export const PROTEIN_TARGET_MIN = 0;
export const PROTEIN_TARGET_MAX = 500;
export const KCAL_TARGET_MIN = 0;
export const KCAL_TARGET_MAX = 10000;
export const WEIGHT_KG_MIN = 20;
export const WEIGHT_KG_MAX = 400;

export function clampDailyTarget(value: unknown, max: number, min = PROTEIN_TARGET_MIN): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

/**
 * Body weight written by sync_apply. Null stays unset.
 * One decimal, then clamped to 20..400 so a phone value cannot fail the batch.
 */
export function syncBodyWeightKg(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  if (rounded < WEIGHT_KG_MIN) return WEIGHT_KG_MIN;
  if (rounded > WEIGHT_KG_MAX) return WEIGHT_KG_MAX;
  return rounded;
}

export const BODY_WEIGHT_ERROR = "Usa un número entre 20 y 400, con máximo un decimal";

export type BodyWeightParse =
  | { state: "empty"; weightKg: null }
  | { state: "incomplete" }
  | { state: "ok"; weightKg: number }
  | { state: "error" };

/** '60,4' and '60.4' are 60.4. Anything else in the field is an error, except a trailing separator. */
export function parseBodyWeightInput(raw: string): BodyWeightParse {
  const trimmed = raw.trim();
  if (!trimmed) return { state: "empty", weightKg: null };
  if (/^\d+[.,]$/.test(trimmed)) return { state: "incomplete" };
  const normalized = trimmed.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return { state: "error" };
  const fraction = normalized.split(".")[1];
  if (fraction && fraction.length > 1) return { state: "error" };
  const weightKg = Number(normalized);
  if (!Number.isFinite(weightKg) || weightKg < WEIGHT_KG_MIN || weightKg > WEIGHT_KG_MAX) {
    return { state: "error" };
  }
  return { state: "ok", weightKg };
}

export function formatBodyWeight(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(value);
}

/** Body weight the diary may trust. Extra decimals and values outside 20..400 stay unset. */
export function acceptedBodyWeightKg(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(value - rounded) > 1e-6) return null;
  if (rounded < WEIGHT_KG_MIN || rounded > WEIGHT_KG_MAX) return null;
  return rounded;
}

/** Editor write. Empty stays empty. A typed number outside the range is clipped, not cleared. */
export function clipDailyTarget(value: unknown, max: number, min = PROTEIN_TARGET_MIN): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

/** Explicit grams stored by hand or after confirming the weight suggestion. */
export function manualProteinGoal(user: { proteinTargetG?: number | null } | null | undefined): number | null {
  return clampDailyTarget(user?.proteinTargetG, PROTEIN_TARGET_MAX);
}

export function manualKcalGoal(user: { kcalTarget?: number | null } | null | undefined): number | null {
  return clampDailyTarget(user?.kcalTarget, KCAL_TARGET_MAX, KCAL_TARGET_MIN);
}

/** Protein grams from body weight, 1.8 g/kg. There is no kcal formula here. */
export function weightProteinSuggestion(weightKg: number | null | undefined): number | null {
  const weight = acceptedBodyWeightKg(weightKg);
  if (weight == null) return null;
  return clampDailyTarget(proteinTargetG(weight), PROTEIN_TARGET_MAX);
}

/**
 * Diary line only. A stored goal wins. With none set, the weight suggestion
 * is shown and is not written until the person confirms it.
 */
export function diaryProteinGoal(
  user: { proteinTargetG?: number | null; weightKg?: number | null } | null | undefined,
): number | null {
  const manual = manualProteinGoal(user);
  if (manual != null) return manual;
  return weightProteinSuggestion(user?.weightKg);
}

export const WEIGHT_PROTEIN_ACTION = "Calcular según mi peso";

/** `60 kg → 108 g`. Null when the weight cannot suggest a goal. */
export function weightProteinLabel(weightKg: number | null | undefined): string | null {
  const weight = acceptedBodyWeightKg(weightKg);
  const grams = weightProteinSuggestion(weight);
  if (weight == null || grams == null) return null;
  return `${String(weight).replace(".", ",")} kg → ${grams} g`;
}

/**
 * The stored protein goal never follows weight by itself.
 * `confirmed` is the only path that copies the 1.8 g/kg suggestion.
 */
export function proteinGoalAfterConfirm(
  currentProtein: number | null | undefined,
  suggestion: number | null | undefined,
  confirmed: boolean,
): number | null {
  const stored = manualProteinGoal({ proteinTargetG: currentProtein });
  if (!confirmed || suggestion == null) return stored;
  return clampDailyTarget(suggestion, PROTEIN_TARGET_MAX) ?? stored;
}

/** True when the suggestion differs from the stored goal, including an empty goal. */
export function proteinGoalNeedsConfirm(current: number | null, suggestion: number | null): boolean {
  if (suggestion == null) return false;
  return current !== suggestion;
}

function finiteNonNegative(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(TIME);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normalizeMealEntry(value: unknown): MealEntry {
  if (typeof value === "string") {
    return { time: null, items: [], note: value };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyMeal();
  const raw = value as Record<string, unknown>;
  const items: MealItem[] = [];
  if (Array.isArray(raw.items)) {
    raw.items.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const row = item as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name : "";
      const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `legacy-item-${index}`;
      const grams = finiteNonNegative(row.grams);
      const proteinG = finiteNonNegative(row.proteinG);
      const carbsG = finiteNonNegative(row.carbsG);
      const fatG = finiteNonNegative(row.fatG);
      items.push({ id, name, grams, proteinG, carbsG, fatG });
    });
  }
  const cleared = raw.cleared === true;
  return {
    time: normalizeTime(raw.time),
    items,
    note: typeof raw.note === "string" ? raw.note : "",
    ...(cleared ? { cleared: true as const } : {}),
  };
}

/** Accepts a v2 log or the legacy `{ desayuno: "avena" }` shape. */
export function normalizeMealLog(value: unknown): MealLog {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const next = emptyMeals();
  for (const slot of MEAL_SLOTS) next[slot.id] = normalizeMealEntry(source[slot.id]);
  return next;
}

export function normalizeFoodDay(day: FoodDay): FoodDay {
  return {
    ...day,
    meals: normalizeMealLog(day.meals),
    comment: typeof day.comment === "string" ? day.comment : "",
    rawInput: typeof day.rawInput === "string" ? day.rawInput : null,
  };
}

export function normalizeFoodDays(days: FoodDay[] | undefined): FoodDay[] {
  return (days ?? []).map((day) => normalizeFoodDay(day));
}

function slotHasContent(entry: MealEntry): boolean {
  return mealLogged(entry) || Boolean(entry.time);
}

/** Same item id: the newer copy wins. Items that exist on only one side stay. */
function mergeMealItems(older: MealItem[], newer: MealItem[]): MealItem[] {
  const newerById = new Map(newer.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const out: MealItem[] = [];
  for (const item of older) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(newerById.get(item.id) ?? item);
  }
  for (const item of newer) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/** Newer slot wins field by field. An empty newer slot does not erase a filled one, unless it was cleared. */
export function mergeMealSlot(olderValue: unknown, newerValue: unknown): MealEntry {
  const older = normalizeMealEntry(olderValue);
  const newer = normalizeMealEntry(newerValue);
  if (newer.cleared) {
    return {
      time: newer.time ?? older.time,
      note: newer.note.trim() ? newer.note : older.note,
      items: newer.items,
      cleared: true,
    };
  }
  if (!slotHasContent(newer)) return older;
  if (!slotHasContent(older)) return newer;
  return {
    time: newer.time ?? older.time,
    note: newer.note.trim() ? newer.note : older.note,
    items: mergeMealItems(older.items, newer.items),
  };
}

export function mergeFoodMeals(olderMeals: unknown, newerMeals: unknown): MealLog {
  const older = normalizeMealLog(olderMeals);
  const newer = normalizeMealLog(newerMeals);
  const meals = emptyMeals();
  for (const slot of MEAL_SLOTS) meals[slot.id] = mergeMealSlot(older[slot.id], newer[slot.id]);
  return meals;
}

function preferNewer(older: FoodDay, newer: FoodDay): boolean {
  if (newer.updatedAt !== older.updatedAt) return newer.updatedAt > older.updatedAt;
  return newer.id >= older.id;
}

/** Folds two days. The newer row keeps the id. Non-empty slots from the other row stay. */
export function mergeFoodDayPair(older: FoodDay, newer: FoodDay): FoodDay {
  const newerIsSecond = preferNewer(older, newer);
  const first = newerIsSecond ? older : newer;
  const second = newerIsSecond ? newer : older;
  return {
    ...second,
    meals: mergeFoodMeals(first.meals, second.meals),
    comment: second.comment.trim() ? second.comment : first.comment,
    rawInput: second.rawInput ?? first.rawInput,
    updatedAt: second.updatedAt >= first.updatedAt ? second.updatedAt : first.updatedAt,
  };
}

/**
 * One row per person and date. Meals are merged; the other id is omitted and must
 * not become a tombstone. A real delete is a date with no surviving row.
 */
export function collapseFoodDays(rows: FoodDay[] | undefined): FoodDay[] {
  const groups = new Map<string, FoodDay[]>();
  for (const row of rows ?? []) {
    const key = `${row.userId}|${row.date}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const out: FoodDay[] = [];
  for (const list of groups.values()) {
    const ranked = [...list].sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
    let merged = ranked[0];
    for (const next of ranked.slice(1)) {
      if (!merged) break;
      merged = mergeFoodDayPair(merged, next);
    }
    if (merged) out.push(merged);
  }
  return out;
}

export function mealLogged(value: unknown): boolean {
  const meal = normalizeMealEntry(value);
  if (meal.note.trim()) return true;
  return meal.items.some(
    (item) => item.name.trim() || item.grams != null || item.proteinG != null || item.carbsG != null || item.fatG != null,
  );
}

function slotText(entry: MealEntry): string {
  const names = entry.items.map((item) => item.name.trim()).filter(Boolean);
  return [entry.note, ...names].filter((part) => part.trim()).join(" ");
}

export type MacroTotals = {
  proteinG: number;
  carbsG: number;
  fatG: number;
  kcal: number;
};

export function macroKcal(proteinG: number, carbsG: number, fatG: number): number {
  return 4 * proteinG + 4 * carbsG + 9 * fatG;
}

const ZERO_TOTALS: MacroTotals = { proteinG: 0, carbsG: 0, fatG: 0, kcal: 0 };

export function mealTotals(value: unknown): MacroTotals {
  const meal = normalizeMealEntry(value);
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  for (const item of meal.items) {
    proteinG += item.proteinG ?? 0;
    carbsG += item.carbsG ?? 0;
    fatG += item.fatG ?? 0;
  }
  return { proteinG, carbsG, fatG, kcal: macroKcal(proteinG, carbsG, fatG) };
}

export function dayTotals(meals: unknown): MacroTotals {
  const log = normalizeMealLog(meals);
  return MEAL_SLOTS.reduce((sum, slot) => {
    const meal = mealTotals(log[slot.id]);
    const proteinG = sum.proteinG + meal.proteinG;
    const carbsG = sum.carbsG + meal.carbsG;
    const fatG = sum.fatG + meal.fatG;
    return { proteinG, carbsG, fatG, kcal: macroKcal(proteinG, carbsG, fatG) };
  }, ZERO_TOTALS);
}

export function formatMacro(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value));
}

/** `P 28/108 · C 51 · G 21 · 505/2200 kcal`. Omit `goal` for a single meal. */
export function formatTotals(totals: MacroTotals, goal?: number | null, kcalGoal?: number | null): string {
  const protein = formatMacro(totals.proteinG);
  const p = goal === undefined ? `P ${protein}` : `P ${protein}/${goal == null ? "—" : goal}`;
  const kcal = formatMacro(totals.kcal);
  const energy = typeof kcalGoal === "number" ? `${kcal}/${kcalGoal} kcal` : `${kcal} kcal`;
  return `${p} · C ${formatMacro(totals.carbsG)} · G ${formatMacro(totals.fatG)} · ${energy}`;
}

/** Day line. A stored goal wins. Otherwise the weight suggestion is shown and stays unsaved. */
export function formatDayTotals(
  totals: MacroTotals,
  user: { proteinTargetG?: number | null; kcalTarget?: number | null; weightKg?: number | null } | null | undefined,
): string {
  return formatTotals(totals, diaryProteinGoal(user), manualKcalGoal(user));
}

export function mealSummary(value: unknown): string {
  const meal = normalizeMealEntry(value);
  const count = meal.items.length;
  const items = count === 1 ? "1 ítem" : `${count} ítems`;
  return `${items} · ${formatMacro(mealTotals(meal).proteinG)}g prot`;
}

export function mealTimeLabel(time: string | null | undefined): string {
  return normalizeTime(time) ?? NO_TIME_LABEL;
}

function meaningfulItem(item: MealItem): boolean {
  return Boolean(item.name.trim()) || item.grams != null || item.proteinG != null || item.carbsG != null || item.fatG != null;
}

export function compactMealLog(meals: unknown): MealLog {
  const log = normalizeMealLog(meals);
  for (const slot of MEAL_SLOTS) {
    log[slot.id] = {
      ...log[slot.id],
      items: log[slot.id].items.filter(meaningfulItem).map((item) => ({ ...item, name: item.name.trim() })),
    };
  }
  return log;
}

const SLOT_ALIASES: { id: MealSlot; keys: string[] }[] = [
  { id: "desayuno", keys: ["desayuno", "desayuné", "desayune"] },
  { id: "mediaManana", keys: ["media mañana", "media manana", "onces", "snack mañana"] },
  { id: "almuerzo", keys: ["almuerzo", "almorcé", "almorce"] },
  { id: "mediaTarde", keys: ["media tarde", "merienda", "snack tarde"] },
  { id: "cena", keys: ["cena", "cené", "cene"] },
];

export function parseMealDump(text: string, base: unknown = emptyMeals()): MealLog {
  const next = normalizeMealLog(base);
  const trimmed = text.trim();
  if (!trimmed) return next;

  const matches: { id: MealSlot; index: number; length: number }[] = [];
  const lower = trimmed.toLowerCase();
  for (const slot of SLOT_ALIASES) {
    for (const key of slot.keys) {
      const idx = lower.indexOf(key);
      if (idx >= 0) matches.push({ id: slot.id, index: idx, length: key.length });
    }
  }

  const firstBySlot = new Map<MealSlot, { index: number; length: number }>();
  for (const hit of matches.sort((a, b) => a.index - b.index)) {
    if (!firstBySlot.has(hit.id)) firstBySlot.set(hit.id, hit);
  }
  const ordered = [...firstBySlot.entries()].sort((a, b) => a[1].index - b[1].index);

  if (ordered.length === 0) {
    const empty = MEAL_SLOTS.find((slot) => !next[slot.id].note.trim() && next[slot.id].items.length === 0);
    if (empty) next[empty.id] = { ...next[empty.id], note: trimmed };
    else next.almuerzo = { ...next.almuerzo, note: [next.almuerzo.note, trimmed].filter(Boolean).join(" · ") };
    return next;
  }

  ordered.forEach((entry, i) => {
    const start = entry[1].index + entry[1].length;
    const end = i + 1 < ordered.length ? ordered[i + 1][1].index : trimmed.length;
    const chunk = trimmed
      .slice(start, end)
      .replace(/^[\s:.\-–—]+/, "")
      .trim();
    if (chunk) next[entry[0]] = { ...next[entry[0]], note: chunk };
  });
  return next;
}

const PROTEIN = [
  "pollo",
  "huevo",
  "huevos",
  "carne",
  "res",
  "cerdo",
  "atún",
  "atun",
  "pescado",
  "salmón",
  "salmon",
  "whey",
  "proteína",
  "proteina",
  "yogur",
  "yogurt",
  "queso",
  "leche",
  "lenteja",
  "frijol",
  "tofu",
  "jamón",
  "jamon",
];
const CARBS = [
  "arroz",
  "papa",
  "patata",
  "avena",
  "pan",
  "arepa",
  "pasta",
  "plátano",
  "platano",
  "banana",
  "yuca",
  "quinoa",
  "cereal",
  "fruta",
];
const DENSE = [
  "aceite",
  "mantequilla",
  "aguacate",
  "nuez",
  "nueces",
  "maní",
  "mani",
  "almendra",
  "crema",
  "queso",
  "chocolate",
  "miel",
];

function hasAny(text: string, words: string[]) {
  const hay = text.toLowerCase();
  return words.some((w) => hay.includes(w));
}

export function mealFlags(meals: unknown) {
  const log = normalizeMealLog(meals);
  const filled = MEAL_SLOTS.filter((slot) => mealLogged(log[slot.id]));
  const blob = filled.map((slot) => slotText(log[slot.id])).join(" ");
  const totals = dayTotals(log);
  return {
    filledCount: filled.length,
    gaps: MEAL_SLOTS.filter((slot) => !mealLogged(log[slot.id])),
    protein: hasAny(blob, PROTEIN) || totals.proteinG > 0,
    carbs: hasAny(blob, CARBS) || totals.carbsG > 0,
    dense: hasAny(blob, DENSE),
    blob,
  };
}

export function nutritionInsights(days: FoodDay[] | undefined, userId: string, lookback = 14) {
  const byDate = new Map(
    normalizeFoodDays(days)
      .filter((d) => d.userId === userId)
      .map((d) => [d.date, d]),
  );
  const stamps: string[] = [];
  for (let i = 0; i < lookback; i += 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    stamps.push(todayStamp(d));
  }

  const skipCount: Record<MealSlot, number> = {
    desayuno: 0,
    mediaManana: 0,
    almuerzo: 0,
    mediaTarde: 0,
    cena: 0,
  };
  let missedDays = 0;
  let noProtein = 0;
  let thinDays = 0;
  let loggedDays = 0;

  for (const stamp of stamps) {
    const day = byDate.get(stamp);
    if (!day) {
      missedDays += 1;
      for (const slot of MEAL_SLOTS) skipCount[slot.id] += 1;
      continue;
    }
    loggedDays += 1;
    const flags = mealFlags(day.meals);
    if (!flags.protein) noProtein += 1;
    if (flags.filledCount < 3) thinDays += 1;
    for (const gap of flags.gaps) skipCount[gap.id] += 1;
  }

  const worstSlot = [...MEAL_SLOTS].sort((a, b) => skipCount[b.id] - skipCount[a.id])[0];
  const issues: string[] = [];
  if (loggedDays === 0) {
    issues.push("Pega lo que comiste y lo ordeno. El objetivo es superávit suave y proteína para ganar músculo.");
  } else if (noProtein >= 3) {
    issues.push(
      "Para ganar músculo, mete huevo, pollo, atún, carne o un lácteo en las tomas grandes.",
    );
  } else if (thinDays >= 3) {
    issues.push("Un snack extra (media mañana o media tarde) es el atajo más fácil al superávit.");
  } else if (worstSlot && skipCount[worstSlot.id] >= 4) {
    issues.push(
      `${worstSlot.label} suele ser el hueco más fácil de llenar para sumar calorías.`,
    );
  } else {
    issues.push("Vas hacia el superávit. Sigue con proteína cerca de ~1.8 g/kg y carbos alrededor del entreno.");
  }

  return { issues, skipCount, missedDays, noProtein, thinDays, loggedDays, lookback };
}

export function nutritionComment(user: User, meals: unknown): string {
  const log = normalizeMealLog(meals);
  const filled = MEAL_SLOTS.filter((slot) => mealLogged(log[slot.id]));
  if (filled.length === 0) {
    return "Cuando me digas qué comiste, lo ordeno y te digo si empuja el superávit.";
  }

  const flags = mealFlags(log);
  const totals = dayTotals(log);
  const hasMacros = MEAL_SLOTS.some((slot) =>
    log[slot.id].items.some((item) => item.proteinG != null || item.carbsG != null || item.fatG != null),
  );
  const gaps = flags.gaps.map((slot) => slot.label.toLowerCase());
  const bits: string[] = [];

  const goal = diaryProteinGoal(user);
  if (user.nutritionGoal === "surplus_muscle") {
    if (hasMacros) {
      const protein = Math.round(totals.proteinG);
      if (goal != null) {
        bits.push(
          protein >= goal
            ? `Proteína de hoy: ${protein} g, en la meta de ${goal} g para recuperar músculo.`
            : `Proteína de hoy: ${protein} g de ${goal} g. Aún cabe más para ganar músculo.`,
        );
      } else if (flags.protein) {
        bits.push("La proteína aparece en los alimentos, eso ayuda a la masa muscular.");
      }
      bits.push(
        `Van ${Math.round(totals.carbsG)} g de carbohidratos, ${Math.round(totals.fatG)} g de grasa y ${Math.round(totals.kcal)} kcal.`,
      );
      if (!flags.carbs) {
        bits.push("Faltan carbohidratos alrededor del entreno para que el día no se quede corto.");
      } else if (!flags.dense && totals.fatG < 20) {
        bits.push(
          "Si el día se ve corto de calorías, súmale un extra (aceite, aguacate, frutos secos o una porción más).",
        );
      }
    } else if (flags.protein && flags.carbs && flags.dense) {
      bits.push(
        "Bien encaminado: hay proteína para recuperar músculo, carbohidratos para entrenar y algo denso en calorías para el superávit.",
      );
    } else if (flags.protein && flags.carbs) {
      bits.push(
        "Hay proteína y carbohidratos, bien para la recuperación. Súmale un extra calórico (aceite, aguacate, frutos secos o una porción más) para no quedarte plano.",
      );
    } else if (flags.protein) {
      bits.push(
        "La proteína aparece, eso ayuda a la masa muscular. Faltan carbohidratos o grasas para que el día sea realmente un superávit.",
      );
    } else {
      bits.push(
        "Casi no veo una fuente clara de proteína. Para ganar músculo apunta a huevos, pollo, atún, carne o un lácteo en cada toma grande.",
      );
    }
  } else {
    bits.push("Registro guardado. Ajusta el objetivo en el perfil si quieres comentarios de superávit.");
  }

  if (gaps.length > 0 && filled.length < 5) {
    bits.push(`Si hay hueco, un extra en ${gaps[0]?.toLowerCase()} suma calorías sin forzar el estómago.`);
  }

  if (!hasMacros && goal != null) {
    const kcal = manualKcalGoal(user);
    bits.push(
      kcal != null
        ? `Objetivo: ${goal} g de proteína y ${kcal} kcal al día, con entrenos de fuerza.`
        : `Objetivo: ${goal} g de proteína al día y un superávit suave (300–500 kcal) con entrenos de fuerza.`,
    );
  }

  return bits.join(" ");
}

export function foodDayFor(data: { foodDays?: FoodDay[] }, userId: string, date: string) {
  return normalizeFoodDays(data.foodDays).find((d) => d.userId === userId && d.date === date) ?? null;
}

export function nextMealPrompt(meals: unknown): { id: MealSlot; question: string } | null {
  const current = normalizeMealLog(meals);
  const prompts: Record<MealSlot, string> = {
    desayuno: "¿Qué desayunaste?",
    mediaManana: "¿Qué te tomaste a media mañana?",
    almuerzo: "¿Qué almorzaste?",
    mediaTarde: "¿Qué merendaste?",
    cena: "¿Qué cenaste?",
  };
  const next = MEAL_SLOTS.find((slot) => !mealLogged(current[slot.id]));
  return next ? { id: next.id, question: prompts[next.id] } : null;
}

function mealPatch(value: unknown): Partial<MealLog> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const patch: Partial<MealLog> = {};
  for (const slot of MEAL_SLOTS) {
    if (Object.prototype.hasOwnProperty.call(source, slot.id)) patch[slot.id] = normalizeMealEntry(source[slot.id]);
  }
  return patch;
}

/**
 * Writes one person's day. Legacy string slots become notes.
 * A later save on another date does not replace this row.
 */
export function upsertFoodDay(args: {
  foodDays: FoodDay[] | undefined;
  user: User | undefined;
  userId: string;
  date: string;
  meals?: unknown;
  rawInput?: string;
  now?: string;
  createId?: () => string;
  /** Slot the editor just saved. An empty item list here is an explicit clear. */
  editedSlot?: MealSlot;
}): { foodDays: FoodDay[]; saved: FoodDay } {
  const list = args.foodDays ?? [];
  const existing = list.find((day) => day.userId === args.userId && day.date === args.date) ?? null;
  const base = existing ? normalizeMealLog(existing.meals) : emptyMeals();
  const overlaid = args.meals == null ? base : { ...base, ...mealPatch(args.meals) };
  const parsed = args.rawInput?.trim() ? parseMealDump(args.rawInput, overlaid) : overlaid;
  const meals = compactMealLog(parsed);
  if (args.editedSlot) {
    const slot = args.editedSlot;
    const hadItems = base[slot].items.length > 0;
    if (meals[slot].items.length === 0 && hadItems) {
      meals[slot] = { ...meals[slot], cleared: true };
    } else if (meals[slot].items.length > 0 && meals[slot].cleared) {
      const nextSlot = { ...meals[slot] };
      delete nextSlot.cleared;
      meals[slot] = nextSlot;
    }
  }
  const saved: FoodDay = {
    id: existing?.id ?? args.createId?.() ?? nid(),
    userId: args.userId,
    date: args.date,
    meals,
    comment: args.user ? nutritionComment(args.user, meals) : (existing?.comment ?? ""),
    rawInput: args.rawInput?.trim() || existing?.rawInput || null,
    updatedAt: args.now ?? new Date().toISOString(),
  };
  const foodDays = existing
    ? list.map((day) => (day.id === existing.id ? saved : day))
    : [...list, saved];
  return { foodDays, saved };
}
