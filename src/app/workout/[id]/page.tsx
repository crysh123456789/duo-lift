"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageTitle } from "@/components/page-title";
import { SessionDateField } from "@/components/session-date-field";
import { Button, Field, Panel } from "@/components/ui";
import { dayFull, whenLabel } from "@/lib/format";
import { DATE_UPDATED, sessionStamp, unclosedBadge } from "@/lib/session-date";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { personName } from "@/lib/people";
import { useOwnGym } from "@/lib/auth/use-own-gym";
import { useGymStore } from "@/lib/store";
import { LoggedSetEditor } from "@/components/logged-set-editor";
import { SET_COPY, SET_DELETE_ENABLED, type SetEditPatch } from "@/lib/sets/edit";
import type { BlockNode } from "@/lib/workout-tree";
import { formatSet, workoutTree, workoutVolume } from "@/lib/workout-tree";

function OwnedBlockSets({
  block,
  onChange,
  onDelete,
}: {
  block: BlockNode;
  onChange: (setId: string, patch: SetEditPatch) => void;
  onDelete: (setId: string) => void;
}) {
  return (
    <div className="space-y-4">
      {block.kind === "circuit" ? (
        <div>
          <p className="text-[11px] uppercase tracking-wider text-accent">Circuito</p>
          <h2 className="text-lg font-medium">{block.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {block.stations.map((station) => station.exercise.name).join(" → ")} · {block.targetRounds} rondas
          </p>
        </div>
      ) : null}
      {block.stations.map((station) => (
        <div key={station.id} className="space-y-2">
          <h2 className="text-lg font-medium">{station.exercise.name}</h2>
          {station.sets.length === 0 ? (
            <p className="text-sm text-muted">{SET_COPY.empty}</p>
          ) : (
            station.sets.map((set, index) => (
              <LoggedSetEditor
                key={set.id}
                set={set}
                label={block.kind === "circuit" ? `Ronda ${set.roundIndex}` : `Serie ${index + 1}`}
                unilateral={station.exercise.isUnilateral}
                onChange={(patch) => onChange(set.id, patch)}
                onDelete={() => onDelete(set.id)}
              />
            ))
          )}
        </div>
      ))}
    </div>
  );
}

export default function WorkoutDetailPage() {
  const params = useParams<{ id: string }>();
  const data = useOwnGym();
  const addReaction = useGymStore((s) => s.addReaction);
  const setWorkoutDate = useGymStore((s) => s.setWorkoutDate);
  const updateSet = useGymStore((s) => s.updateSet);
  const removeSet = useGymStore((s) => s.removeSet);
  const [comment, setComment] = useState("");
  const tree = workoutTree(data, params.id);
  const [dateNotice, setDateNotice] = useState("");

  if (!tree) {
    return (
      <div className="py-10 text-center">
        <p className="text-muted">No encontré esa sesión.</p>
        <Link href="/history" className="mt-3 inline-block text-accent">
          Volver al historial
        </Link>
      </div>
    );
  }

  const author = data.users.find((u) => u.id === tree.userId);
  const isMine = tree.userId === data.activeUserId;
  const reactions = data.reactions.filter((r) => r.workoutId === tree.id);
  const alreadyFired = reactions.some(
    (r) => r.fromUserId === data.activeUserId && r.kind === "fire",
  );

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageTitle
        title={`${tree.title ?? "Entrenamiento"} · ${format(new Date(tree.startedAt), "d MMM", { locale: es })}`}
      />
      <div>
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">
          {personName(author)}
        </p>
        <h1 className="text-3xl font-medium tracking-tight">{tree.title ?? "Entrenamiento"}</h1>
        <p className="mt-1 text-sm text-muted">
          {whenLabel(tree.startedAt)} · {dayFull(tree.startedAt)} · {Math.round(workoutVolume(data, tree.id))} kg
          {tree.perceivedExertion ? ` · RPE ${tree.perceivedExertion}` : ""}
        </p>
        {tree.status === "in_progress" ? (
          <p className="mt-2 text-xs text-accent">{unclosedBadge(tree.startedAt)}</p>
        ) : null}
      </div>

      {isMine ? (
        <SessionDateField
          value={sessionStamp(tree.startedAt)}
          notice={dateNotice}
          onChange={(next) => {
            if (!setWorkoutDate(tree.id, next)) return;
            setDateNotice(DATE_UPDATED);
          }}
        />
      ) : null}

      {tree.blocks.map((block) => (
        <Panel key={block.id} className="space-y-3 p-4">
          {isMine ? (
            <OwnedBlockSets
              block={block}
              onChange={(setId, patch) => updateSet(setId, patch)}
              onDelete={(setId) => {
                if (!SET_DELETE_ENABLED) return false;
                return removeSet(setId);
              }}
            />
          ) : block.kind === "circuit" ? (
            <>
              <p className="text-[11px] uppercase tracking-wider text-accent">Circuito</p>
              <h2 className="mb-3 text-lg font-medium">{block.name}</h2>
              <p className="mb-3 text-sm text-muted">
                {block.stations.map((s) => s.exercise.name).join(" → ")} · {block.targetRounds} rondas
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1 font-medium">Ronda</th>
                      {block.stations.map((s) => (
                        <th key={s.id} className="py-1 font-medium">
                          {s.exercise.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: block.targetRounds }, (_, i) => i + 1).map((round) => (
                      <tr key={round} className="border-t border-line">
                        <td className="py-2 font-mono text-muted">{round}</td>
                        {block.stations.map((station) => {
                          const set = station.sets.find((s) => s.roundIndex === round);
                          return (
                            <td key={station.id} className="py-2">
                              {set ? formatSet(set) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            block.stations.map((station) => (
              <div key={station.id}>
                <h2 className="mb-2 text-lg font-medium">{station.exercise.name}</h2>
                <ul className="space-y-1 font-mono text-sm">
                  {station.sets.map((set, i) => (
                    <li key={set.id} className="flex justify-between text-muted">
                      <span>Serie {i + 1}</span>
                      <span className="text-foreground">{formatSet(set)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </Panel>
      ))}

      {tree.notes ? (
        <Panel className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted">Notas</p>
          <p className="mt-1 text-sm">{tree.notes}</p>
        </Panel>
      ) : null}

      <Panel className="p-4">
        <p className="mb-3 text-[11px] uppercase tracking-wider text-muted">Del duo</p>
        <ul className="space-y-2 text-sm">
          {reactions.length === 0 ? (
            <li className="text-muted">Nadie ha reaccionado todavía.</li>
          ) : (
            reactions.map((r) => {
              const from = data.users.find((u) => u.id === r.fromUserId);
              return (
                <li key={r.id}>
                  <span className="text-muted">{from?.displayName}</span>
                  {r.kind === "fire" ? " mandó fuego." : r.body ? `: ${r.body}` : " comentó."}
                </li>
              );
            })
          )}
        </ul>
        {!isMine ? (
          <div className="mt-4 space-y-2">
            <Button
              variant="primary"
              className="w-full"
              disabled={alreadyFired}
              onClick={() => void addReaction(tree.id, "fire")}
            >
              {alreadyFired ? "Fuego enviado" : "Mandar fuego"}
            </Button>
            <Field label="Comentario">
              <div className="flex gap-2">
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
                />
                <Button
                  disabled={!comment.trim()}
                  onClick={() => {
                    void addReaction(tree.id, "comment", comment);
                    setComment("");
                  }}
                >
                  Enviar
                </Button>
              </div>
            </Field>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
