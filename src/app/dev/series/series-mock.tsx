"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LoggedSetEditor } from "@/components/logged-set-editor";
import { SET_DELETE_ENABLED } from "@/lib/sets/edit";
import { useGymStore } from "@/lib/store";

const LOCAL_CONFIRM_BODY = "Se quita de este entrenamiento. No vuelve a aparecer.";
const MOCK_WORKOUT = "mock-session";
const MOCK_BLOCK = "mock-block";
const MOCK_STATION = "mock-station";

function ensureMockSession() {
  const state = useGymStore.getState();
  if (state.workouts.some((row) => row.id === MOCK_WORKOUT)) return;
  const now = "2026-10-25T18:00:00.000Z";
  useGymStore.setState({
    workouts: [
      ...state.workouts,
      {
        id: MOCK_WORKOUT,
        userId: state.activeUserId,
        duoId: state.duo.id,
        startedAt: now,
        endedAt: now,
        status: "completed",
        notes: null,
        perceivedExertion: 7,
        title: "Pecho de prueba",
      },
    ],
    blocks: [
      ...state.blocks,
      {
        id: MOCK_BLOCK,
        workoutId: MOCK_WORKOUT,
        position: 1,
        kind: "straight",
        name: null,
        targetRounds: 1,
        restBetweenRoundsSec: null,
        restSec: 90,
      },
    ],
    stations: [
      ...state.stations,
      {
        id: MOCK_STATION,
        blockId: MOCK_BLOCK,
        exerciseId: "ex-banca",
        position: 1,
        notes: null,
      },
    ],
    sets: [
      ...state.sets,
      {
        id: "mock-set-1",
        stationId: MOCK_STATION,
        roundIndex: 1,
        setIndex: 1,
        reps: 8,
        repsRight: null,
        weightKg: 40,
        durationSec: null,
        rpe: 7,
        isWarmup: false,
        completed: true,
        loggedAt: now,
      },
      {
        id: "mock-set-2",
        stationId: MOCK_STATION,
        roundIndex: 1,
        setIndex: 2,
        reps: 6,
        repsRight: null,
        weightKg: 42.5,
        durationSec: null,
        rpe: 8,
        isWarmup: false,
        completed: true,
        loggedAt: now,
      },
    ],
  });
}

function subscribePreview() {
  return () => {};
}

function readPreview() {
  return new URLSearchParams(window.location.search).get("borrar");
}

/** Phone-only fixture. Sync stays on Local because this route never sets a user id. */
export function SeriesMock() {
  const allSets = useGymStore((state) => state.sets);
  const sets = allSets
    .filter((row) => row.stationId === MOCK_STATION)
    .sort((a, b) => a.setIndex - b.setIndex);
  const updateSet = useGymStore((state) => state.updateSet);
  const removeSet = useGymStore((state) => state.removeSet);
  const preview = useSyncExternalStore(subscribePreview, readPreview, () => null);

  useEffect(() => {
    ensureMockSession();
  }, []);

  function initialMode(index: number) {
    if (index !== 0 || !SET_DELETE_ENABLED) return undefined;
    if (preview === "confirmar") return "confirm" as const;
    if (preview === "eliminando") return "deleting" as const;
    if (preview === "error") return "error" as const;
    return undefined;
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Sesión de prueba</p>
        <h1 className="text-3xl font-medium tracking-tight">Press banca</h1>
        <p className="mt-1 text-sm text-muted">Solo en este teléfono. No se sube a la nube.</p>
      </div>
      {sets.length === 0 ? (
        <p className="text-sm text-muted">Sin series.</p>
      ) : (
        sets.map((set, index) => (
          <LoggedSetEditor
            key={`${set.id}-${preview ?? "view"}`}
            set={set}
            label={`Serie ${index + 1}`}
            unilateral={false}
            initialMode={initialMode(index)}
            confirmBody={LOCAL_CONFIRM_BODY}
            onChange={(patch) => updateSet(set.id, patch)}
            onDelete={() => {
              if (!SET_DELETE_ENABLED) return false;
              return removeSet(set.id);
            }}
          />
        ))
      )}
    </div>
  );
}
