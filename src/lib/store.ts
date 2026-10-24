"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IDS, nid } from "./ids";
import { bumpKg, getWorkingLoad, loadKey } from "./loads";
import { createAccountSeed, createSeed, mergeGymData, omitDemo, seedWorkoutWasEdited, stripLegacySeed } from "./seed";
import { duoUnlocked } from "./session-flag";
import { inferSplitDay, splitDayByTitle, SPLIT, type SplitDay } from "./split";
import type {
  Exercise,
  GymData,
  MealLog,
  MuscleGroup,
  ReactionKind,
  ReminderSettings,
  SetLog,
  User,
} from "./types";
import { todayStamp, upsertFoodDay } from "./nutrition";
import {
  atLocalStamp,
  isValidStamp,
  omitWorkout,
  planSplitStart,
  reusableOpenId,
  shiftStartedAt,
} from "./session-date";
import { DEFAULT_REMINDERS } from "./reminders";

type FinishPayload = {
  title?: string;
  notes?: string;
  perceivedExertion?: number | null;
};

type GymStore = GymData & {
  activeUserId: string;
  switchUser: (userId: string) => void;
  updateUser: (
    userId: string,
    patch: Partial<Pick<User, "displayName" | "unitSystem" | "heightCm" | "weightKg" | "nutritionGoal">>,
  ) => void;
  startWorkout: (opts?: { date?: string }) => string;
  startSplitDay: (dayId?: SplitDay["id"], opts?: { date?: string }) => string;
  setWorkoutDate: (workoutId: string, stamp: string) => boolean;
  finishWorkout: (workoutId: string, payload?: FinishPayload) => void;
  abandonWorkout: (workoutId: string) => void;
  addStraightBlock: (workoutId: string, exerciseId: string) => string;
  addStraightBlocks: (workoutId: string, exerciseIds: string[]) => void;
  addCircuitBlock: (
    workoutId: string,
    payload: { name: string; exerciseIds: string[]; rounds: number },
  ) => string;
  removeBlock: (blockId: string) => void;
  addSet: (stationId: string, roundIndex?: number) => string;
  updateSet: (setId: string, patch: Partial<SetLog>) => void;
  bumpStationWeight: (stationId: string, delta: number) => void;
  bumpWorkingLoad: (exerciseId: string, delta: number) => void;
  toggleSetComplete: (setId: string) => void;
  removeSet: (setId: string) => void;
  addReaction: (workoutId: string, kind: ReactionKind, body?: string) => void;
  addCustomExercise: (payload: {
    name: string;
    muscleGroup: MuscleGroup;
    isUnilateral?: boolean;
  }) => string;
  saveFoodDay: (payload: { date: string; meals?: MealLog; rawInput?: string }) => string;
  updateReminders: (patch: Partial<ReminderSettings>) => void;
  markReminderFired: (key: string) => void;
};

function emptySet(stationId: string, roundIndex: number, setIndex: number): SetLog {
  return {
    id: nid(),
    stationId,
    roundIndex,
    setIndex,
    reps: null,
    repsRight: null,
    weightKg: null,
    durationSec: null,
    rpe: null,
    isWarmup: false,
    completed: false,
    loggedAt: new Date().toISOString(),
  };
}

export const useGymStore = create<GymStore>()(
  persist(
    (set, get) => ({
      ...createAccountSeed(),
      activeUserId: IDS.cristian,

      switchUser: (userId) => set({ activeUserId: userId }),

      updateUser: (userId, patch) =>
        set((state) => ({
          users: state.users.map((u) => (u.id === userId ? { ...u, ...patch } : u)),
        })),

      startWorkout: (opts) => {
        if (!duoUnlocked()) return "";
        const state = get();
        const now = new Date();
        const today = todayStamp(now);
        if (opts?.date && !isValidStamp(opts.date, today)) return "";
        const stamp = opts?.date && isValidStamp(opts.date, today) ? opts.date : today;
        const reuse = reusableOpenId(state.workouts, state.activeUserId, stamp);
        if (reuse) return reuse;
        const id = nid();
        set({
          workouts: [
            ...state.workouts,
            {
              id,
              userId: state.activeUserId,
              duoId: state.duo.id,
              startedAt: opts?.date ? atLocalStamp(stamp, now) : now.toISOString(),
              endedAt: null,
              status: "in_progress",
              notes: null,
              perceivedExertion: null,
              title: null,
              updatedAt: now.toISOString(),
            },
          ],
        });
        return id;
      },

      startSplitDay: (dayId, opts) => {
        if (!duoUnlocked()) return "";
        const day = SPLIT.find((d) => d.id === dayId) ?? SPLIT[0]!;
        const now = new Date();
        const today = todayStamp(now);
        if (opts?.date && !isValidStamp(opts.date, today)) return "";
        const stamp = opts?.date && isValidStamp(opts.date, today) ? opts.date : today;
        const prior = get();
        const plan = planSplitStart(
          prior.workouts,
          prior.activeUserId,
          stamp,
          day.id,
          (workout) => (inferSplitDay(prior, workout) ?? splitDayByTitle(workout.title))?.id ?? null,
        );
        if (plan.action === "reuse") return plan.id;
        if (plan.action === "replace-same-day") get().abandonWorkout(plan.id);
        const id = get().startWorkout({ date: stamp });
        if (!id) return "";
        set((state) => ({
          workouts: state.workouts.map((w) =>
            w.id === id ? { ...w, title: day.title } : w,
          ),
        }));
        for (const circuit of day.circuits) {
          get().addCircuitBlock(id, {
            name: circuit.name,
            exerciseIds: circuit.exerciseIds,
            rounds: circuit.rounds,
          });
        }
        if (day.straightIds.length > 0) get().addStraightBlocks(id, day.straightIds);
        return id;
      },

      finishWorkout: (workoutId, payload) => {
        if (!duoUnlocked()) return;
        set((state) => {
          const current = state.workouts.find((w) => w.id === workoutId);
          if (!current) return {};
          const inferred = inferSplitDay(state, current);
          return {
            workouts: state.workouts.map((w) =>
              w.id === workoutId
                ? {
                    ...w,
                    status: "completed" as const,
                    endedAt: new Date().toISOString(),
                    title:
                      payload?.title?.trim() ||
                      inferred?.title ||
                      w.title ||
                      "Entrenamiento",
                    notes: payload?.notes?.trim() || w.notes,
                    perceivedExertion: payload?.perceivedExertion ?? w.perceivedExertion,
                    updatedAt: new Date().toISOString(),
                  }
                : w,
            ),
          };
        });
      },

      setWorkoutDate: (workoutId, stamp) => {
        if (!duoUnlocked()) return false;
        const today = todayStamp();
        if (!isValidStamp(stamp, today)) return false;
        const current = get().workouts.find((workout) => workout.id === workoutId);
        if (!current) return false;
        const startedAt = shiftStartedAt(current.startedAt, stamp, today);
        if (!startedAt) return false;
        set((state) => ({
          workouts: state.workouts.map((workout) =>
            workout.id === workoutId
              ? { ...workout, startedAt, updatedAt: new Date().toISOString() }
              : workout,
          ),
        }));
        return true;
      },

      abandonWorkout: (workoutId) => set((state) => omitWorkout(state, workoutId)),

      addStraightBlock: (workoutId, exerciseId) => {
        get().addStraightBlocks(workoutId, [exerciseId]);
        const last = get()
          .blocks.filter((b) => b.workoutId === workoutId)
          .sort((a, b) => b.position - a.position)[0];
        return last?.id ?? "";
      },

      addStraightBlocks: (workoutId, exerciseIds) =>
        set((state) => {
          const workout = state.workouts.find((w) => w.id === workoutId);
          const already = new Set(
            state.blocks
              .filter((b) => b.workoutId === workoutId && b.kind === "straight")
              .flatMap((b) =>
                state.stations.filter((s) => s.blockId === b.id).map((s) => s.exerciseId),
              ),
          );
          const unique = [...new Set(exerciseIds)].filter((id) => !already.has(id));
          if (unique.length === 0) return {};
          let position = state.blocks
            .filter((b) => b.workoutId === workoutId)
            .reduce((m, b) => Math.max(m, b.position), 0);
          const blocks: GymData["blocks"] = [];
          const stations: GymData["stations"] = [];
          const sets: SetLog[] = [];
          for (const exerciseId of unique) {
            position += 1;
            const blockId = nid();
            const stationId = nid();
            const load = workout
              ? getWorkingLoad(state, workout.userId, exerciseId)
              : null;
            blocks.push({
              id: blockId,
              workoutId,
              position,
              kind: "straight" as const,
              name: null,
              targetRounds: 1,
              restBetweenRoundsSec: null,
              restSec: null,
            });
            stations.push({
              id: stationId,
              blockId,
              exerciseId,
              position: 1,
              notes: null,
            });
            for (let i = 1; i <= 3; i += 1) {
              sets.push({
                ...emptySet(stationId, 1, i),
                weightKg: load?.weightKg ?? null,
                reps: load?.reps ?? 8,
                repsRight: load?.repsRight ?? null,
              });
            }
          }
          return {
            blocks: [...state.blocks, ...blocks],
            stations: [...state.stations, ...stations],
            sets: [...state.sets, ...sets],
          };
        }),

      addCircuitBlock: (workoutId, payload) => {
        const prior = get();
        const workout = prior.workouts.find((w) => w.id === workoutId);
        const blockId = nid();
        const newStations = payload.exerciseIds.map((exerciseId, i) => ({
          id: nid(),
          blockId,
          exerciseId,
          position: i + 1,
          notes: null,
        }));
        const newSets = newStations.flatMap((station) => {
          const load = workout
            ? getWorkingLoad(prior, workout.userId, station.exerciseId)
            : null;
          return Array.from({ length: payload.rounds }, (_, r) => ({
            ...emptySet(station.id, r + 1, 1),
            weightKg: load?.weightKg ?? null,
            reps: load?.reps ?? 8,
            repsRight: load?.repsRight ?? null,
          }));
        });
        set((state) => {
          const position =
            state.blocks.filter((b) => b.workoutId === workoutId).reduce((m, b) => Math.max(m, b.position), 0) +
            1;
          return {
            blocks: [
              ...state.blocks,
              {
                id: blockId,
                workoutId,
                position,
                kind: "circuit",
                name: payload.name.trim() || "Circuito",
                targetRounds: payload.rounds,
                restBetweenRoundsSec: 90,
                restSec: null,
              },
            ],
            stations: [...state.stations, ...newStations],
            sets: [...state.sets, ...newSets],
          };
        });
        return blockId;
      },

      removeBlock: (blockId) =>
        set((state) => {
          const stationIds = state.stations.filter((s) => s.blockId === blockId).map((s) => s.id);
          return {
            blocks: state.blocks.filter((b) => b.id !== blockId),
            stations: state.stations.filter((s) => s.blockId !== blockId),
            sets: state.sets.filter((s) => !stationIds.includes(s.stationId)),
          };
        }),

      addSet: (stationId, roundIndex = 1) => {
        const id = nid();
        set((state) => {
          const existing = state.sets.filter(
            (s) => s.stationId === stationId && s.roundIndex === roundIndex,
          );
          const last = [...existing].sort((a, b) => a.setIndex - b.setIndex).at(-1);
          const station = state.stations.find((s) => s.id === stationId);
          const block = state.blocks.find((b) => b.id === station?.blockId);
          const workout = state.workouts.find((w) => w.id === block?.workoutId);
          const load =
            station && workout
              ? getWorkingLoad(state, workout.userId, station.exerciseId)
              : null;
          const setIndex = existing.reduce((m, s) => Math.max(m, s.setIndex), 0) + 1;
          return {
            sets: [
              ...state.sets,
              {
                ...emptySet(stationId, roundIndex, setIndex),
                id,
                weightKg: last?.weightKg ?? load?.weightKg ?? null,
                reps: last?.reps ?? load?.reps ?? 8,
                repsRight: last?.repsRight ?? load?.repsRight ?? null,
              },
            ],
          };
        });
        return id;
      },

      updateSet: (setId, patch) => {
        if (!duoUnlocked()) return;
        set((state) => {
          const current = state.sets.find((s) => s.id === setId);
          if (!current) return {};
          const next = { ...current, ...patch, loggedAt: new Date().toISOString() };
          let workingLoads = state.workingLoads ?? {};
          if (next.weightKg != null && !next.isWarmup) {
            const station = state.stations.find((s) => s.id === current.stationId);
            const block = state.blocks.find((b) => b.id === station?.blockId);
            const workout = state.workouts.find((w) => w.id === block?.workoutId);
            if (station && workout) {
              workingLoads = {
                ...workingLoads,
                [loadKey(workout.userId, station.exerciseId)]: {
                  weightKg: next.weightKg,
                  reps: next.reps ?? 8,
                  repsRight: next.repsRight,
                },
              };
            }
          }
          return {
            workingLoads,
            sets: state.sets.map((s) => (s.id === setId ? next : s)),
          };
        });
      },

      bumpStationWeight: (stationId, delta) =>
        set((state) => {
          const station = state.stations.find((s) => s.id === stationId);
          const block = state.blocks.find((b) => b.id === station?.blockId);
          const workout = state.workouts.find((w) => w.id === block?.workoutId);
          if (!station || !workout) return {};
          const current = getWorkingLoad(state, workout.userId, station.exerciseId);
          const typed = state.sets
            .filter((s) => s.stationId === stationId && s.weightKg != null)
            .map((s) => s.weightKg as number);
          const fromSets = typed.length > 0 ? Math.max(...typed) : null;
          const nextKg = bumpKg(fromSets ?? current?.weightKg ?? null, delta);
          return {
            workingLoads: {
              ...(state.workingLoads ?? {}),
              [loadKey(workout.userId, station.exerciseId)]: {
                weightKg: nextKg,
                reps: current?.reps ?? 8,
                repsRight: current?.repsRight ?? null,
              },
            },
            sets: state.sets.map((s) =>
              s.stationId === stationId && !s.completed
                ? { ...s, weightKg: nextKg, loggedAt: new Date().toISOString() }
                : s,
            ),
          };
        }),

      bumpWorkingLoad: (exerciseId, delta) =>
        set((state) => {
          const current = getWorkingLoad(state, state.activeUserId, exerciseId);
          const nextKg = bumpKg(current?.weightKg ?? null, delta);
          const openStationIds = new Set(
            state.stations
              .filter((station) => {
                if (station.exerciseId !== exerciseId) return false;
                const block = state.blocks.find((b) => b.id === station.blockId);
                const workout = state.workouts.find((w) => w.id === block?.workoutId);
                return (
                  workout?.userId === state.activeUserId && workout.status === "in_progress"
                );
              })
              .map((station) => station.id),
          );
          return {
            workingLoads: {
              ...(state.workingLoads ?? {}),
              [loadKey(state.activeUserId, exerciseId)]: {
                weightKg: nextKg,
                reps: current?.reps ?? 8,
                repsRight: current?.repsRight ?? null,
              },
            },
            sets: state.sets.map((s) =>
              openStationIds.has(s.stationId) && !s.completed
                ? { ...s, weightKg: nextKg, loggedAt: new Date().toISOString() }
                : s,
            ),
          };
        }),

      toggleSetComplete: (setId) =>
        set((state) => {
          const current = state.sets.find((s) => s.id === setId);
          if (!current) return {};
          const completed = !current.completed;
          const sets = state.sets.map((s) =>
            s.id === setId
              ? { ...s, completed, loggedAt: new Date().toISOString() }
              : s,
          );
          let workingLoads = state.workingLoads ?? {};
          if (completed && current.weightKg != null && !current.isWarmup) {
            const station = state.stations.find((s) => s.id === current.stationId);
            const block = state.blocks.find((b) => b.id === station?.blockId);
            const workout = state.workouts.find((w) => w.id === block?.workoutId);
            if (station && workout) {
              workingLoads = {
                ...workingLoads,
                [loadKey(workout.userId, station.exerciseId)]: {
                  weightKg: current.weightKg,
                  reps: current.reps ?? 8,
                  repsRight: current.repsRight,
                },
              };
            }
          }
          return { sets, workingLoads };
        }),

      removeSet: (setId) => set((state) => ({ sets: state.sets.filter((s) => s.id !== setId) })),

      addReaction: (workoutId, kind, body) =>
        set((state) => ({
          reactions: [
            ...state.reactions,
            {
              id: nid(),
              workoutId,
              fromUserId: state.activeUserId,
              kind,
              body: body?.trim() || null,
              createdAt: new Date().toISOString(),
            },
          ],
        })),

      addCustomExercise: ({ name, muscleGroup, isUnilateral }) => {
        const id = nid();
        set((state) => ({
          exercises: [
            ...state.exercises,
            {
              id,
              name: name.trim(),
              muscleGroup,
              equipment: "other",
              isUnilateral: Boolean(isUnilateral),
              createdByUserId: state.activeUserId,
              duoId: state.duo.id,
            } satisfies Exercise,
          ],
        }));
        return id;
      },

      saveFoodDay: ({ date, meals, rawInput }) => {
        if (!duoUnlocked()) return "";
        const state = get();
        const user = state.users.find((u) => u.id === state.activeUserId);
        const { foodDays, saved } = upsertFoodDay({
          foodDays: state.foodDays,
          user,
          userId: state.activeUserId,
          date,
          meals,
          rawInput,
        });
        set({ foodDays });
        return saved.id;
      },

      updateReminders: (patch) =>
        set((state) => {
          const current = state.reminders ?? DEFAULT_REMINDERS;
          return {
            reminders: {
              ...current,
              ...patch,
              meals: patch.meals ?? current.meals,
              gym: patch.gym ?? current.gym,
              lastFired: patch.lastFired ?? current.lastFired,
            },
          };
        }),

      markReminderFired: (key) =>
        set((state) => {
          const current = state.reminders ?? DEFAULT_REMINDERS;
          return {
            reminders: {
              ...current,
              lastFired: {
                ...current.lastFired,
                [key]: new Date().toISOString(),
              },
            },
          };
        }),
    }),
    {
      name: "duo-lift-v2",
      version: 8,
      migrate: (persistedState, fromVersion) => {
        const persisted = (persistedState ?? {}) as Partial<GymStore>;
        const cleaned = fromVersion < 6 ? stripLegacySeed(persisted) : persisted;
        const merged = mergeGymData(cleaned, createAccountSeed(), { preferSeedLoads: fromVersion < 6 });
        if (fromVersion < 6) {
          const dropped = stripLegacySeed(merged);
          merged.workouts = dropped.workouts ?? [];
          merged.blocks = dropped.blocks ?? [];
          merged.stations = dropped.stations ?? [];
          merged.sets = dropped.sets ?? [];
          merged.reactions = dropped.reactions ?? [];
        }
        if (fromVersion < 7) {
          const seed = createSeed();
          merged.users = merged.users.map((user) => {
            const fromSeed = seed.users.find((s) => s.id === user.id);
            const prototype = !user.displayName?.trim() || user.displayName.trim().toLowerCase() === "amigo";
            return prototype && fromSeed ? { ...user, displayName: fromSeed.displayName } : user;
          });
          merged.workouts = merged.workouts.map((w) => {
            const fromSeed = seed.workouts.find((s) => s.id === w.id);
            if (!fromSeed || seedWorkoutWasEdited(merged, w.id, seed)) return w;
            return { ...w, notes: fromSeed.notes };
          });
          merged.duo = { ...merged.duo, name: seed.duo.name };
        }
        const real = omitDemo(merged);
        return {
          ...cleaned,
          ...real,
          activeUserId: (cleaned as Partial<GymStore>).activeUserId ?? IDS.cristian,
        };
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<GymStore>;
        const data = omitDemo(mergeGymData(persisted, createAccountSeed()));
        return {
          ...currentState,
          ...persisted,
          ...data,
          activeUserId: persisted.activeUserId ?? currentState.activeUserId,
        };
      },
    },
  ),
);
