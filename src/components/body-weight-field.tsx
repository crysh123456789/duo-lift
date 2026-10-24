"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  BODY_WEIGHT_ERROR,
  formatBodyWeight,
  parseBodyWeightInput,
} from "@/lib/nutrition";

export function BodyWeightField({
  weightKg,
  onWeightKg,
  onInvalid,
}: {
  weightKg: number | null;
  onWeightKg: (weightKg: number | null) => void;
  onInvalid?: (invalid: boolean) => void;
}) {
  const errorId = useId();
  const [text, setText] = useState(() => formatBodyWeight(weightKg));
  const [showIncomplete, setShowIncomplete] = useState(false);
  const dirty = useRef(false);
  const parsed = parseBodyWeightInput(text);
  const invalid = parsed.state === "error" || (showIncomplete && parsed.state === "incomplete");

  useEffect(() => {
    onInvalid?.(invalid);
  }, [invalid, onInvalid]);

  useEffect(() => {
    if (dirty.current) return;
    setText(formatBodyWeight(weightKg));
    setShowIncomplete(false);
  }, [weightKg]);

  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-muted">Peso (kg)</span>
      <input
        inputMode="decimal"
        value={text}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onFocus={() => {
          dirty.current = true;
        }}
        onBlur={() => {
          if (parsed.state === "incomplete") setShowIncomplete(true);
          if (parsed.state === "ok" || parsed.state === "empty") dirty.current = false;
        }}
        onChange={(event) => {
          const next = event.target.value;
          dirty.current = true;
          setText(next);
          setShowIncomplete(false);
          const nextParsed = parseBodyWeightInput(next);
          if (nextParsed.state === "ok") onWeightKg(nextParsed.weightKg);
          else if (nextParsed.state === "empty") {
            dirty.current = false;
            onWeightKg(null);
          }
        }}
        className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 font-mono outline-none focus:border-accent"
      />
      {invalid ? (
        <span id={errorId} role="alert" className="mt-1 block text-xs text-danger">
          {BODY_WEIGHT_ERROR}
        </span>
      ) : null}
    </label>
  );
}
