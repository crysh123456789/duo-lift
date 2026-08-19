"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useState } from "react";
import type { Exercise } from "@/lib/types";
import { Button, Field, Panel } from "./ui";
import { ExercisePicker } from "./exercise-picker";

export function CircuitBuilder({
  onCreate,
  onClose,
}: {
  onCreate: (payload: { name: string; exerciseIds: string[]; rounds: number }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("Continuo tren inferior");
  const [rounds, setRounds] = useState(3);
  const [stations, setStations] = useState<Exercise[]>([]);
  const [picking, setPicking] = useState(false);

  function move(index: number, dir: -1 | 1) {
    setStations((prev) => {
      const next = index + dir;
      if (next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      const a = copy[index];
      const b = copy[next];
      if (!a || !b) return prev;
      copy[index] = b;
      copy[next] = a;
      return copy;
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 grid place-items-end bg-black/60 p-3 md:place-items-center">
        <Panel className="w-full max-w-lg p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium">Nuevo circuito</h2>
            <button type="button" onClick={onClose} className="text-sm text-muted">
              Cerrar
            </button>
          </div>
          <div className="space-y-3">
            <Field label="Nombre">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
              />
            </Field>
            <Field label="Rondas">
              <div className="flex items-center gap-2">
                <Button onClick={() => setRounds((n) => Math.max(2, n - 1))}>−</Button>
                <span className="w-10 text-center font-mono text-lg">{rounds}</span>
                <Button onClick={() => setRounds((n) => Math.min(12, n + 1))}>+</Button>
              </div>
            </Field>
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">Estaciones en orden</p>
              {stations.length === 0 ? (
                <p className="mb-2 text-sm text-muted">
                  Añade al menos dos. Ejemplo: abductores → zancadas → hatch.
                </p>
              ) : (
                <ol className="mb-2 space-y-1">
                  {stations.map((ex, i) => (
                    <li
                      key={`${ex.id}-${i}`}
                      className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-muted">{i + 1}</span>
                      <span className="flex-1">{ex.name}</span>
                      <button type="button" onClick={() => move(i, -1)} className="text-muted">
                        <ArrowUp size={14} />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} className="text-muted">
                        <ArrowDown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setStations(stations.filter((_, idx) => idx !== i))}
                        className="text-muted hover:text-danger"
                      >
                        Quitar
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <Button className="w-full" onClick={() => setPicking(true)}>
                Añadir estación
              </Button>
            </div>
            <Button
              variant="primary"
              className="w-full"
              disabled={stations.length < 2}
              onClick={() =>
                onCreate({
                  name,
                  rounds,
                  exerciseIds: stations.map((s) => s.id),
                })
              }
            >
              Crear circuito
            </Button>
          </div>
        </Panel>
      </div>
      {picking ? (
        <ExercisePicker
          title="Estación del circuito"
          onPick={(ex) => {
            setStations((prev) => [...prev, ex]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </>
  );
}
