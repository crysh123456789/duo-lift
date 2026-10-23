"use client";

import { useId } from "react";
import { DATE_FIELD_HINT, DATE_FIELD_LABEL } from "@/lib/session-date";
import { todayStamp } from "@/lib/nutrition";

export function SessionDateField({
  value,
  onChange,
  notice,
}: {
  value: string;
  onChange: (stamp: string) => void;
  notice?: string;
}) {
  const hintId = useId();
  return (
    <div>
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wider text-muted">
          {DATE_FIELD_LABEL}
        </span>
        <input
          type="date"
          value={value}
          max={todayStamp()}
          aria-describedby={hintId}
          onChange={(event) => {
            const next = event.target.value;
            if (next) onChange(next);
          }}
          className="h-12 min-h-12 w-full rounded-xl border border-line bg-surface-2 px-3 text-base text-foreground outline-none focus:border-accent"
        />
      </label>
      <p id={hintId} className="mt-1 text-xs text-muted">
        {DATE_FIELD_HINT}
      </p>
      {notice ? (
        <p className="mt-1 text-sm text-accent" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
