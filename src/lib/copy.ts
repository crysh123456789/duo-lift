export function addExercisesLabel(count: number): string {
  if (count === 1) return "Añadir 1 ejercicio";
  return `Añadir ${count} ejercicios`;
}

export function formatLoad(weightKg: number | null | undefined, reps: number | null | undefined): string {
  const repsBit = reps == null ? "" : ` × ${reps}`;
  if (weightKg == null) return `cuerpo${repsBit}`;
  return `${weightKg} kg${repsBit}`;
}
