"use client";

import { NutritionDiary } from "@/components/nutrition-diary";

export default function NutritionPage() {
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Diario</p>
        <h1 className="text-3xl font-medium tracking-tight">Comida</h1>
        <p className="mt-2 text-sm text-muted">
          Hora, alimentos y macros. Toca la proteína del día para poner la meta a mano.
        </p>
      </div>
      <NutritionDiary />
    </div>
  );
}
