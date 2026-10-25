"use client";

import { useId, useState } from "react";
import {
  SET_COPY,
  SET_DELETE_ENABLED,
  commitSetDraft,
  editableSetSnapshot,
  type SetEditPatch,
} from "@/lib/sets/edit";
import type { SetLog } from "@/lib/types";
import { formatSet } from "@/lib/workout-tree";
import { Button, NumberField } from "./ui";

const TOUCH = "min-h-11 min-w-11";

export function DeleteSetConfirm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  if (!SET_DELETE_ENABLED) return null;
  return (
    <div
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-set-editor="confirm"
      className="space-y-3 rounded-xl border border-danger/40 bg-danger/10 p-3"
    >
      <p id={titleId} className="text-sm font-medium">
        {SET_COPY.confirmTitle}
      </p>
      <p id={bodyId} className="text-sm text-muted">
        {SET_COPY.confirmBody}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button className={`${TOUCH} w-full sm:flex-1`} onClick={onCancel}>
          {SET_COPY.cancel}
        </Button>
        <Button variant="danger" className={`${TOUCH} w-full border border-danger/40 sm:flex-1`} onClick={onConfirm}>
          {SET_COPY.confirmDelete}
        </Button>
      </div>
    </div>
  );
}

function ToggleField({
  pressed,
  onClick,
  onLabel,
  offLabel,
}: {
  pressed: boolean;
  onClick: () => void;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`${TOUCH} w-full rounded-xl border px-3 text-sm ${
        pressed ? "border-accent/50 bg-accent/10 text-foreground" : "border-line bg-surface text-muted"
      }`}
    >
      {pressed ? onLabel : offLabel}
    </button>
  );
}

export function LoggedSetEditor({
  set,
  label,
  unilateral,
  onChange,
  onDelete,
}: {
  set: SetLog;
  label: string;
  unilateral: boolean;
  onChange: (patch: SetEditPatch) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [draft, setDraft] = useState<SetEditPatch>(() => editableSetSnapshot(set));
  const showRight = unilateral || set.repsRight != null;
  const shown = mode === "edit" ? { ...set, ...draft } : set;

  function openEdit() {
    setDraft(editableSetSnapshot(set));
    setMode("edit");
  }

  function cancelEdit() {
    setDraft(editableSetSnapshot(set));
    setMode("view");
  }

  function saveEdit() {
    const patch = commitSetDraft(editableSetSnapshot(set), draft);
    if (patch) onChange(patch);
    setMode("view");
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3" data-set-editor={mode} data-set-id={set.id}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted">{label}</p>
        <p className="text-right font-mono text-sm text-foreground">{formatSet(shown)}</p>
      </div>

      {mode === "view" ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row" data-set-actions="view">
          <Button className={`${TOUCH} w-full sm:flex-1`} onClick={openEdit}>
            {SET_COPY.edit}
          </Button>
          {SET_DELETE_ENABLED ? (
            <Button
              variant="danger"
              className={`${TOUCH} w-full border border-danger/40 sm:flex-1`}
              onClick={() => setMode("confirm")}
            >
              {SET_COPY.delete}
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === "edit" ? (
        <div className="mt-3 space-y-3" data-set-actions="edit">
          <NumberField
            label={SET_COPY.weight}
            value={draft.weightKg ?? null}
            onChange={(weightKg) => setDraft((current) => ({ ...current, weightKg }))}
          />
          <NumberField
            label={showRight ? SET_COPY.repsLeft : SET_COPY.reps}
            value={draft.reps ?? null}
            onChange={(reps) => setDraft((current) => ({ ...current, reps }))}
          />
          {showRight ? (
            <NumberField
              label={SET_COPY.repsRight}
              value={draft.repsRight ?? null}
              onChange={(repsRight) => setDraft((current) => ({ ...current, repsRight }))}
            />
          ) : null}
          <NumberField
            label={SET_COPY.rpe}
            value={draft.rpe ?? null}
            onChange={(rpe) => setDraft((current) => ({ ...current, rpe }))}
          />
          <NumberField
            label={SET_COPY.seconds}
            value={draft.durationSec ?? null}
            onChange={(durationSec) => setDraft((current) => ({ ...current, durationSec }))}
          />
          <ToggleField
            pressed={draft.isWarmup === true}
            onLabel={SET_COPY.warmupOn}
            offLabel={SET_COPY.warmupOff}
            onClick={() => setDraft((current) => ({ ...current, isWarmup: !current.isWarmup }))}
          />
          <ToggleField
            pressed={draft.completed !== false}
            onLabel={SET_COPY.loggedOn}
            offLabel={SET_COPY.loggedOff}
            onClick={() => setDraft((current) => ({ ...current, completed: !current.completed }))}
          />
          <p className="text-xs text-muted">{SET_COPY.savedHint}</p>
          <div className="flex gap-2">
            <Button variant="secondary" className={`${TOUCH} min-w-0 flex-1`} onClick={cancelEdit}>
              {SET_COPY.cancel}
            </Button>
            <Button variant="primary" className={`${TOUCH} min-w-0 flex-1`} onClick={saveEdit}>
              {SET_COPY.done}
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "confirm" && SET_DELETE_ENABLED ? (
        <div className="mt-3">
          <DeleteSetConfirm onCancel={() => setMode("view")} onConfirm={onDelete} />
        </div>
      ) : null}
    </div>
  );
}
