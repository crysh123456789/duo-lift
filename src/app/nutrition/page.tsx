"use client";

import { NutritionDiary } from "@/components/nutrition-diary";
import { PageTitle } from "@/components/page-title";
import { foodDayFor, nextMealPrompt, todayStamp } from "@/lib/nutrition";
import { useGymStore } from "@/lib/store";

export default function NutritionPage() {
  const data = useGymStore();
  const today = foodDayFor(data, data.activeUserId, todayStamp());
  const prompt = nextMealPrompt(today?.meals);

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <PageTitle title={prompt?.question ?? "Diario"} />
      <div>
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Diario</p>
        <h1 className="text-3xl font-medium tracking-tight">{prompt?.question ?? "Comida de hoy"}</h1>
        <p className="mt-2 text-sm text-muted">
          Subir de peso con salud y ganar músculo: superávit suave y proteína cerca de 1.8 g/kg.
        </p>
      </div>
      <NutritionDiary />
    </div>
  );
}
