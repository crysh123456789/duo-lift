"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import {
  WEIGHT_PROTEIN_ACTION,
  manualProteinGoal,
  proteinGoalAfterConfirm,
  weightProteinLabel,
  weightProteinSuggestion,
} from "@/lib/nutrition";

/** Shows the 1.8 g/kg figure. The stored goal changes only after Confirmar. */
export function WeightProteinControl({
  weightKg,
  proteinTargetG,
  onApply,
}: {
  weightKg: number | null | undefined;
  proteinTargetG: number | null | undefined;
  onApply: (proteinTargetG: number) => void;
}) {
  const suggestion = weightProteinSuggestion(weightKg);
  const stored = manualProteinGoal({ proteinTargetG });
  const label = weightProteinLabel(weightKg);
  const [pending, setPending] = useState<number | null>(null);
  const confirming = suggestion != null && pending === suggestion;

  if (suggestion == null || label == null) return null;

  function confirm() {
    const next = proteinGoalAfterConfirm(proteinTargetG, suggestion, pending === suggestion);
    if (next == null) return;
    onApply(next);
    setPending(null);
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        Según tu peso: <span className="font-mono text-foreground">{label}</span> (1,8 g/kg).
      </p>
      {stored == null ? (
        <p className="text-xs text-muted">Sugerencia visible. No se guarda hasta que confirmes.</p>
      ) : stored !== suggestion ? (
        <p className="text-xs text-muted">Meta guardada: {stored} g. El peso no la cambia.</p>
      ) : (
        <p className="text-xs text-muted">Meta guardada: {stored} g.</p>
      )}
      {confirming ? (
        <div className="space-y-2">
          <p className="text-sm">
            {stored != null && stored !== suggestion
              ? `¿Guardar ${suggestion} g en lugar de ${stored} g?`
              : `¿Guardar ${suggestion} g de proteína?`}
          </p>
          <div className="flex gap-2">
            <Button variant="primary" className="h-11 min-h-11 flex-1" onClick={confirm}>
              Confirmar
            </Button>
            <Button className="h-11 min-h-11 flex-1" onClick={() => setPending(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <Button className="h-11 min-h-11 w-full" onClick={() => setPending(suggestion)}>
          {WEIGHT_PROTEIN_ACTION}
        </Button>
      )}
    </div>
  );
}
