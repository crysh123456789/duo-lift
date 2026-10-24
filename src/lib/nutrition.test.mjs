import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dueReminders, DEFAULT_REMINDERS } from "./reminders.ts";
import {
  dayTotals,
  emptyMeals,
  formatTotals,
  macroKcal,
  manualProteinGoal,
  mealSummary,
  mealTotals,
  normalizeMealEntry,
  normalizeMealLog,
  nutritionComment,
  parseMealDump,
  proteinTargetG,
  upsertFoodDay,
} from "./nutrition.ts";
import { mergeRemoteSnapshot } from "./sync/merge.ts";
import { toSyncPayload } from "./sync/payload.ts";
import { gymFromRows } from "./sync/rows.ts";
import { canonicalize } from "./sync/snapshot.ts";
import { stableStringify } from "./sync/stable.ts";

const cristian = {
  id: "user-cristian",
  email: "cristian@duo.lift",
  displayName: "Cristian",
  avatarHue: 78,
  unitSystem: "kg",
  heightCm: 167,
  weightKg: 60,
  nutritionGoal: "surplus_muscle",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const reminders = {
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

function gym(patch = {}) {
  return {
    users: [cristian],
    duo: { id: "duo-1", name: "Duo Lift", inviteCode: "GYM2", createdAt: "2026-01-01T00:00:00.000Z" },
    members: [{ duoId: "duo-1", userId: "user-cristian", role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" }],
    exercises: [],
    workouts: [],
    blocks: [],
    stations: [],
    sets: [],
    reactions: [],
    workingLoads: {},
    foodDays: [],
    reminders,
    ...patch,
  };
}

const huevo = { id: "huevo", name: "Huevo", grams: 100, proteinG: 13, carbsG: 1, fatG: 11 };
const avena = { id: "avena", name: "Avena", grams: 60, proteinG: 8, carbsG: 40, fatG: 4 };
const leche = { id: "leche", name: "Leche", grams: 200, proteinG: 7, carbsG: 10, fatG: 6 };

function breakfastLog() {
  const meals = emptyMeals();
  meals.desayuno = { time: "08:30", note: "", items: [huevo, avena, leche] };
  return meals;
}

describe("day totals", () => {
  test("sums P/C/G and derives kcal with 4, 4 and 9", () => {
    const meal = mealTotals({ time: "08:30", note: "", items: [huevo, avena, leche] });
    assert.equal(meal.proteinG, 28);
    assert.equal(meal.carbsG, 51);
    assert.equal(meal.fatG, 21);
    assert.equal(meal.kcal, macroKcal(28, 51, 21));
    assert.equal(meal.kcal, 505);

    const meals = breakfastLog();
    meals.almuerzo = {
      time: "13:00",
      note: "",
      items: [{ id: "pollo", name: "Pollo", grams: 150, proteinG: 40, carbsG: 0, fatG: 5 }],
    };
    const day = dayTotals(meals);
    assert.equal(day.proteinG, 68);
    assert.equal(day.carbsG, 51);
    assert.equal(day.fatG, 26);
    assert.equal(day.kcal, macroKcal(68, 51, 26));
    assert.equal(formatTotals(day, proteinTargetG(60)), "P 68/108 · C 51 · G 26 · 710 kcal");
    assert.equal(mealSummary(meals.desayuno), "3 ítems · 28g prot");
    assert.equal(mealSummary({ time: null, note: "", items: [huevo] }), "1 ítem · 13g prot");
  });

  test("null macros count as zero and do not erase the item", () => {
    const meal = mealTotals({
      time: null,
      note: "",
      items: [{ id: "pan", name: "Pan", grams: 40, proteinG: null, carbsG: 20, fatG: null }],
    });
    assert.equal(meal.proteinG, 0);
    assert.equal(meal.carbsG, 20);
    assert.equal(meal.kcal, 80);
  });
});

describe("manual nutrition goals", () => {
  test("diary uses the manual protein goal and ignores weight", () => {
    assert.equal(manualProteinGoal({ proteinTargetG: 90, weightKg: 60 }), 90);
    assert.equal(manualProteinGoal({ weightKg: 60 }), null);
    assert.equal(manualProteinGoal({ proteinTargetG: 0, weightKg: 60 }), null);
    assert.equal(proteinTargetG(60), 108);
    const day = dayTotals(breakfastLog());
    assert.equal(formatTotals(day, manualProteinGoal({ weightKg: 60 })), "P 28/— · C 51 · G 21 · 505 kcal");
    assert.equal(formatTotals(day, manualProteinGoal({ proteinTargetG: 90, weightKg: 60 })), "P 28/90 · C 51 · G 21 · 505 kcal");

    const withGoal = nutritionComment({ ...cristian, proteinTargetG: 90 }, breakfastLog());
    assert.match(withGoal, /90 g/);
    assert.equal(/108/.test(withGoal), false);
    const unset = nutritionComment(cristian, breakfastLog());
    assert.equal(/108/.test(unset), false);
    const noteOnly = { ...emptyMeals(), desayuno: { time: "08:00", items: [], note: "avena" } };
    assert.equal(/108/.test(nutritionComment(cristian, noteOnly)), false);
    assert.match(nutritionComment({ ...cristian, proteinTargetG: 90, kcalTarget: 2200 }, noteOnly), /90 g de proteína y 2200 kcal/);
  });

  test("manual targets round-trip through the sync payload", () => {
    const user = {
      ...cristian,
      id: "11111111-1111-4111-8111-111111111111",
      proteinTargetG: 90,
      kcalTarget: 2200,
    };
    const payload = toSyncPayload(gym({ users: [user] }), []);
    assert.equal(payload.users[0].protein_target_g, 90);
    assert.equal(payload.users[0].kcal_target, 2200);
    const cleared = toSyncPayload(gym({ users: [cristian] }), []);
    assert.equal(cleared.users[0].protein_target_g, null);
    assert.equal(cleared.users[0].kcal_target, null);
    const { data } = gymFromRows({
      duo: { id: "duo-1", name: "Duo Lift", invite_code: "GYM2", created_at: "2026-01-01T00:00:00.000Z" },
      users: [
        {
          id: user.id,
          email: user.email,
          display_name: user.displayName,
          avatar_hue: 78,
          unit_system: "kg",
          height_cm: "167",
          weight_kg: "60",
          nutrition_goal: "surplus_muscle",
          protein_target_g: "90",
          kcal_target: "2200",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      members: [],
      exercises: [],
      workouts: [],
      blocks: [],
      stations: [],
      sets: [],
      reactions: [],
      foodDays: [],
      loads: [],
      reminders: null,
    });
    assert.equal(data.users[0].proteinTargetG, 90);
    assert.equal(data.users[0].kcalTarget, 2200);
  });
});

describe("soft-migrate legacy text", () => {
  test("string slots become notes and stay editable beside new items", () => {
    const legacy = {
      desayuno: "avena y huevos",
      mediaManana: "",
      almuerzo: "arroz con pollo",
      mediaTarde: "   ",
      cena: "",
    };
    const migrated = normalizeMealLog(legacy);
    assert.equal(migrated.desayuno.note, "avena y huevos");
    assert.equal(migrated.desayuno.time, null);
    assert.deepEqual(migrated.desayuno.items, []);
    assert.equal(migrated.almuerzo.note, "arroz con pollo");
    assert.equal(migrated.mediaManana.note, "");

    const first = upsertFoodDay({
      foodDays: [],
      user: cristian,
      userId: cristian.id,
      date: "2026-10-22",
      meals: legacy,
      now: "2026-10-22T12:00:00.000Z",
      createId: () => "food-legacy",
    });
    assert.equal(first.saved.meals.desayuno.note, "avena y huevos");

    const withItems = upsertFoodDay({
      foodDays: first.foodDays,
      user: cristian,
      userId: cristian.id,
      date: "2026-10-22",
      meals: {
        desayuno: {
          ...first.saved.meals.desayuno,
          time: "08:15",
          items: [huevo],
        },
      },
      now: "2026-10-22T13:00:00.000Z",
    });
    assert.equal(withItems.saved.id, "food-legacy");
    assert.equal(withItems.saved.meals.desayuno.note, "avena y huevos");
    assert.equal(withItems.saved.meals.desayuno.time, "08:15");
    assert.equal(withItems.saved.meals.desayuno.items[0].name, "Huevo");
    assert.equal(withItems.saved.meals.almuerzo.note, "arroz con pollo");
    assert.equal(dayTotals(withItems.saved.meals).proteinG, 13);
  });

  test("a pasted paragraph fills notes without wiping items or time", () => {
    const base = emptyMeals();
    base.desayuno = { time: "08:00", note: "", items: [huevo] };
    const next = parseMealDump("Desayuno: café con pan. Cena: sopa.", base);
    assert.equal(next.desayuno.time, "08:00");
    assert.equal(next.desayuno.items[0].id, "huevo");
    assert.equal(next.desayuno.note, "café con pan.");
    assert.equal(next.cena.note, "sopa.");
  });

  test("canonicalize is idempotent so a legacy day does not sync forever", () => {
    const once = canonicalize(
      gym({
        foodDays: [
          {
            id: "food-legacy",
            userId: "user-cristian",
            date: "2026-10-22",
            meals: { desayuno: "avena y huevos", mediaManana: "", almuerzo: "", mediaTarde: "", cena: "" },
            comment: "",
            rawInput: "avena y huevos",
            updatedAt: "2026-10-22T12:00:00.000Z",
          },
        ],
      }),
    );
    const twice = canonicalize(once);
    assert.equal(stableStringify(once.foodDays), stableStringify(twice.foodDays));
    assert.equal(once.foodDays[0].meals.desayuno.note, "avena y huevos");
    assert.deepEqual(once.foodDays[0].meals.desayuno.items, []);
  });
});

describe("time and items persistence", () => {
  test("keeps time and items on the day, and a later day does not replace it", () => {
    const saved = upsertFoodDay({
      foodDays: [],
      user: cristian,
      userId: cristian.id,
      date: "2026-10-22",
      meals: breakfastLog(),
      now: "2026-10-22T12:00:00.000Z",
      createId: () => "food-22",
    });
    assert.equal(saved.saved.meals.desayuno.time, "08:30");
    assert.equal(saved.saved.meals.desayuno.items.length, 3);

    const cleared = upsertFoodDay({
      foodDays: saved.foodDays,
      user: cristian,
      userId: cristian.id,
      date: "2026-10-22",
      meals: {
        desayuno: { ...saved.saved.meals.desayuno, time: null },
      },
      now: "2026-10-22T12:05:00.000Z",
    });
    assert.equal(cleared.saved.meals.desayuno.time, null);
    assert.equal(cleared.saved.meals.desayuno.items.length, 3);

    const restored = upsertFoodDay({
      foodDays: cleared.foodDays,
      user: cristian,
      userId: cristian.id,
      date: "2026-10-22",
      meals: {
        desayuno: { ...cleared.saved.meals.desayuno, time: "8:05" },
      },
      now: "2026-10-22T12:06:00.000Z",
    });
    assert.equal(restored.saved.meals.desayuno.time, "08:05");
    assert.equal(normalizeMealEntry({ time: "25:99", items: [], note: "" }).time, null);

    const nextDay = upsertFoodDay({
      foodDays: restored.foodDays,
      user: cristian,
      userId: cristian.id,
      date: "2026-10-23",
      meals: {
        almuerzo: {
          time: "13:10",
          note: "",
          items: [{ id: "pollo", name: "Pollo", grams: 150, proteinG: 40, carbsG: 0, fatG: 5 }],
        },
      },
      now: "2026-10-23T18:00:00.000Z",
      createId: () => "food-23",
    });
    assert.equal(nextDay.foodDays.length, 2);
    const yesterday = nextDay.foodDays.find((day) => day.date === "2026-10-22");
    assert.equal(yesterday.meals.desayuno.time, "08:05");
    assert.equal(yesterday.meals.desayuno.items.length, 3);
    assert.equal(nextDay.saved.meals.almuerzo.items[0].proteinG, 40);
  });

  test("drops a blank item and syncs the structured meal both ways", () => {
    const meals = breakfastLog();
    meals.desayuno.items = [...meals.desayuno.items, { id: "blank", name: "  ", grams: null, proteinG: null, carbsG: null, fatG: null }];
    const saved = upsertFoodDay({
      foodDays: [],
      user: cristian,
      userId: cristian.id,
      date: "2026-10-23",
      meals,
      now: "2026-10-23T12:00:00.000Z",
      createId: () => "food-23",
    });
    assert.deepEqual(
      saved.saved.meals.desayuno.items.map((item) => item.id),
      ["huevo", "avena", "leche"],
    );

    const payload = toSyncPayload(gym({ foodDays: [saved.saved] }), []);
    assert.equal(payload.food_days[0].date, "2026-10-23");
    assert.equal(payload.food_days[0].meals.desayuno.time, "08:30");
    assert.equal(payload.food_days[0].meals.desayuno.items[1].name, "Avena");
    assert.equal(payload.food_days[0].meals.desayuno.items[1].carbsG, 40);

    const remoteTables = {
      duo: { id: "duo-1", name: "Duo Lift", invite_code: "GYM2", created_at: "2026-01-01T00:00:00.000Z" },
      users: [],
      members: [],
      exercises: [],
      workouts: [],
      blocks: [],
      stations: [],
      sets: [],
      reactions: [],
      loads: [],
      reminders: null,
      foodDays: [
        {
          id: "food-23",
          user_id: "user-cristian",
          date: "2026-10-23",
          meals: payload.food_days[0].meals,
          comment: saved.saved.comment,
          raw_input: null,
          updated_at: "2026-10-23T12:00:00.000Z",
        },
        {
          id: "food-old",
          user_id: "user-cristian",
          date: "2026-10-21",
          meals: { desayuno: "avena y huevos", mediaManana: "", almuerzo: "", mediaTarde: "", cena: "" },
          comment: "",
          raw_input: null,
          updated_at: "2026-10-21T12:00:00.000Z",
        },
      ],
    };
    const { data } = gymFromRows(remoteTables);
    const fresh = data.foodDays.find((day) => day.id === "food-23");
    const old = data.foodDays.find((day) => day.id === "food-old");
    assert.equal(fresh.meals.desayuno.time, "08:30");
    assert.equal(fresh.meals.desayuno.items[2].fatG, 6);
    assert.equal(dayTotals(fresh.meals).kcal, 505);
    assert.equal(old.meals.desayuno.note, "avena y huevos");
    assert.equal(old.meals.desayuno.items.length, 0);
  });

  test("a newer structured day wins over the same legacy row", () => {
    const legacy = gym({
      foodDays: [
        {
          id: "food-22",
          userId: "user-cristian",
          date: "2026-10-22",
          meals: { desayuno: "avena y huevos", mediaManana: "", almuerzo: "", mediaTarde: "", cena: "" },
          comment: "",
          rawInput: null,
          updatedAt: "2026-10-22T12:00:00.000Z",
        },
      ],
    });
    const remote = gym({
      foodDays: [
        {
          id: "food-22",
          userId: "user-cristian",
          date: "2026-10-22",
          meals: breakfastLog(),
          comment: "",
          rawInput: null,
          updatedAt: "2026-10-22T18:00:00.000Z",
        },
      ],
    });
    const merged = mergeRemoteSnapshot(legacy, remote, [], { seed: gym(), remindersFromServer: true });
    assert.equal(merged.foodDays[0].meals.desayuno.items.length, 3);
    assert.equal(merged.foodDays[0].meals.desayuno.time, "08:30");
    assert.equal(dayTotals(merged.foodDays[0].meals).proteinG, 28);
  });

  test("legacy free text still counts as logged for reminders", () => {
    const due = dueReminders({
      reminders: { ...DEFAULT_REMINDERS, enabled: true },
      userId: cristian.id,
      foodDays: [
        {
          id: "food-23",
          userId: cristian.id,
          date: "2026-10-23",
          meals: { desayuno: "huevos", mediaManana: "", almuerzo: "", mediaTarde: "", cena: "" },
          comment: "",
          rawInput: null,
          updatedAt: "2026-10-23T08:30:00.000Z",
        },
      ],
      workouts: [],
      now: new Date(2026, 9, 23, 9, 0, 0),
    });
    assert.equal(due.some((row) => row.key.endsWith(":desayuno")), false);
  });
});
