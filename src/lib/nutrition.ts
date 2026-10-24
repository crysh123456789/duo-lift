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

/** Bounds stored by sync_apply. Out of range is treated as unset. */
export const PROTEIN_TARGET_MAX = 1000;
export const KCAL_TARGET_MAX = 20000;

export function clampDailyTarget(value: unknown, max: number): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > max) return null;
  return rounded;
}

/** Diary denominator. Weight-derived grams are a later phase and are not used here. */
export function manualProteinGoal(user: { proteinTargetG?: number | null } | null | undefined): number | null {
  return clampDailyTarget(user?.proteinTargetG, PROTEIN_TARGET_MAX);
}

export function manualKcalGoal(user: { kcalTarget?: number | null } | null | undefined): number | null {
  return clampDailyTarget(user?.kcalTarget, KCAL_TARGET_MAX);
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
  return {
    time: normalizeTime(raw.time),
    items,
    note: typeof raw.note === "string" ? raw.note : "",
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

/** `P 28/108 · C 51 · G 21 · 505 kcal`. Omit `goal` for a single meal. */
export function formatTotals(totals: MacroTotals, goal?: number | null): string {
  const protein = formatMacro(totals.proteinG);
  const p = goal === undefined ? `P ${protein}` : `P ${protein}/${goal == null ? "—" : goal}`;
  return `${p} · C ${formatMacro(totals.carbsG)} · G ${formatMacro(totals.fatG)} · ${formatMacro(totals.kcal)} kcal`;
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

  const manual = manualProteinGoal(user);
  if (user.nutritionGoal === "surplus_muscle") {
    if (hasMacros) {
      const protein = Math.round(totals.proteinG);
      if (manual != null) {
        bits.push(
          protein >= manual
            ? `Proteína de hoy: ${protein} g, en la meta de ${manual} g para recuperar músculo.`
            : `Proteína de hoy: ${protein} g de ${manual} g. Aún cabe más para ganar músculo.`,
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

  if (!hasMacros && manual != null) {
    const kcal = manualKcalGoal(user);
    bits.push(
      kcal != null
        ? `Objetivo: ${manual} g de proteína y ${kcal} kcal al día, con entrenos de fuerza.`
        : `Objetivo: ${manual} g de proteína al día y un superávit suave (300–500 kcal) con entrenos de fuerza.`,
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
}): { foodDays: FoodDay[]; saved: FoodDay } {
  const list = args.foodDays ?? [];
  const existing = list.find((day) => day.userId === args.userId && day.date === args.date) ?? null;
  const base = existing ? normalizeMealLog(existing.meals) : emptyMeals();
  const overlaid = args.meals == null ? base : { ...base, ...mealPatch(args.meals) };
  const parsed = args.rawInput?.trim() ? parseMealDump(args.rawInput, overlaid) : overlaid;
  const meals = compactMealLog(parsed);
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
