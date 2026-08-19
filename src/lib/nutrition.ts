import type { FoodDay, MealLog, MealSlot, User } from "./types";

export const MEAL_SLOTS: { id: MealSlot; label: string }[] = [
  { id: "desayuno", label: "Desayuno" },
  { id: "mediaManana", label: "Media mañana" },
  { id: "almuerzo", label: "Almuerzo" },
  { id: "mediaTarde", label: "Media tarde" },
  { id: "cena", label: "Cena" },
];

export function emptyMeals(): MealLog {
  return {
    desayuno: "",
    mediaManana: "",
    almuerzo: "",
    mediaTarde: "",
    cena: "",
  };
}

export function todayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function bmi(heightCm: number, weightKg: number) {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export function proteinTargetG(weightKg: number) {
  return Math.round(weightKg * 1.8);
}

const SLOT_ALIASES: { id: MealSlot; keys: string[] }[] = [
  { id: "desayuno", keys: ["desayuno", "desayuné", "desayune"] },
  { id: "mediaManana", keys: ["media mañana", "media manana", "onces", "snack mañana"] },
  { id: "almuerzo", keys: ["almuerzo", "almorcé", "almorce"] },
  { id: "mediaTarde", keys: ["media tarde", "merienda", "snack tarde"] },
  { id: "cena", keys: ["cena", "cené", "cene"] },
];

export function parseMealDump(text: string, base: MealLog = emptyMeals()): MealLog {
  const next = { ...base };
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
    const empty = MEAL_SLOTS.find((s) => !next[s.id].trim());
    if (empty) next[empty.id] = trimmed;
    else next.almuerzo = [next.almuerzo, trimmed].filter(Boolean).join(" · ");
    return next;
  }

  ordered.forEach((entry, i) => {
    const start = entry[1].index + entry[1].length;
    const end = i + 1 < ordered.length ? ordered[i + 1][1].index : trimmed.length;
    const chunk = trimmed
      .slice(start, end)
      .replace(/^[\s:.\-–—]+/, "")
      .trim();
    if (chunk) next[entry[0]] = chunk;
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

export function mealFlags(meals: MealLog) {
  const filled = MEAL_SLOTS.filter((s) => meals[s.id].trim());
  const blob = filled.map((s) => meals[s.id]).join(" ");
  return {
    filledCount: filled.length,
    gaps: MEAL_SLOTS.filter((s) => !meals[s.id].trim()),
    protein: hasAny(blob, PROTEIN),
    carbs: hasAny(blob, CARBS),
    dense: hasAny(blob, DENSE),
    blob,
  };
}

export function nutritionInsights(days: FoodDay[] | undefined, userId: string, lookback = 14) {
  const byDate = new Map(
    (days ?? []).filter((d) => d.userId === userId).map((d) => [d.date, d]),
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

export function nutritionComment(user: User, meals: MealLog): string {
  const filled = MEAL_SLOTS.filter((s) => meals[s.id].trim());
  const blob = filled.map((s) => meals[s.id]).join(" ");
  if (filled.length === 0) {
    return "Cuando me digas qué comiste, lo ordeno y te digo si empuja el superávit.";
  }

  const protein = hasAny(blob, PROTEIN);
  const carbs = hasAny(blob, CARBS);
  const dense = hasAny(blob, DENSE);
  const gaps = MEAL_SLOTS.filter((s) => !meals[s.id].trim()).map((s) => s.label.toLowerCase());
  const bits: string[] = [];

  if (user.nutritionGoal === "surplus_muscle") {
    if (protein && carbs && dense) {
      bits.push(
        "Bien encaminado: hay proteína para recuperar músculo, carbohidratos para entrenar y algo denso en calorías para el superávit.",
      );
    } else if (protein && carbs) {
      bits.push(
        "Hay proteína y carbohidratos, bien para la recuperación. Súmale un extra calórico (aceite, aguacate, frutos secos o una porción más) para no quedarte plano.",
      );
    } else if (protein) {
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

  if (user.weightKg) {
    bits.push(
      `Objetivo: ~${proteinTargetG(user.weightKg)} g de proteína al día y un superávit suave (300–500 kcal) con entrenos de fuerza.`,
    );
  }

  return bits.join(" ");
}

export function foodDayFor(data: { foodDays?: FoodDay[] }, userId: string, date: string) {
  return (data.foodDays ?? []).find((d) => d.userId === userId && d.date === date) ?? null;
}

export function nextMealPrompt(meals: MealLog | undefined): { id: MealSlot; question: string } | null {
  const current = meals ?? emptyMeals();
  const prompts: Record<MealSlot, string> = {
    desayuno: "¿Qué desayunaste?",
    mediaManana: "¿Qué te tomaste a media mañana?",
    almuerzo: "¿Qué almorzaste?",
    mediaTarde: "¿Qué merendaste?",
    cena: "¿Qué cenaste?",
  };
  const next = MEAL_SLOTS.find((s) => !current[s.id]?.trim());
  return next ? { id: next.id, question: prompts[next.id] } : null;
}
