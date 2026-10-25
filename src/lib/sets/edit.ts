import type { SetLog } from "@/lib/types";

/** Fields a logged series can change. Identity stays put so a sync cannot move the row. */
export const EDITABLE_SET_FIELDS = [
  "reps",
  "repsRight",
  "weightKg",
  "durationSec",
  "rpe",
  "isWarmup",
  "completed",
] as const;

export type EditableSetField = (typeof EDITABLE_SET_FIELDS)[number];
export type SetEditPatch = Partial<Pick<SetLog, EditableSetField>>;

export const SET_COPY = {
  edit: "Editar",
  delete: "Eliminar",
  deleteSeries: "Eliminar serie",
  done: "Listo",
  cancel: "Cancelar",
  confirmDelete: "Sí, eliminar",
  confirmTitle: "¿Eliminar esta serie?",
  confirmBody:
    "Se quita de este entrenamiento. El cambio queda en el teléfono y se sincroniza. No vuelve a aparecer.",
  savedHint: "Se guarda en el teléfono al cambiar.",
  weight: "Peso (kg)",
  reps: "Reps",
  repsLeft: "Reps izquierda",
  repsRight: "Reps derecha",
  rpe: "RPE",
  seconds: "Segundos",
  warmupOn: "Calentamiento · sí",
  warmupOff: "Calentamiento · no",
  loggedOn: "Registrada · sí",
  loggedOff: "Registrada · no",
  empty: "Sin series.",
} as const;

export function setEditPatch(patch: Partial<SetLog>): SetEditPatch {
  const next: SetEditPatch = {};
  if ("reps" in patch && patch.reps !== undefined) next.reps = patch.reps;
  if ("repsRight" in patch && patch.repsRight !== undefined) next.repsRight = patch.repsRight;
  if ("weightKg" in patch && patch.weightKg !== undefined) next.weightKg = patch.weightKg;
  if ("durationSec" in patch && patch.durationSec !== undefined) next.durationSec = patch.durationSec;
  if ("rpe" in patch && patch.rpe !== undefined) next.rpe = patch.rpe;
  if ("isWarmup" in patch && patch.isWarmup !== undefined) next.isWarmup = patch.isWarmup;
  if ("completed" in patch && patch.completed !== undefined) next.completed = patch.completed;
  return next;
}
