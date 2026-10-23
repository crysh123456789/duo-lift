"use client";

import { Suspense } from "react";
import { WorkoutLogger } from "@/components/workout-logger";

export default function NewWorkoutPage() {
  return (
    <Suspense>
      <WorkoutLogger />
    </Suspense>
  );
}
