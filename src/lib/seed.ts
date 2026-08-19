import { subDays } from "date-fns";
import { IDS } from "./ids";
import { loadKey } from "./loads";
import { DEFAULT_REMINDERS } from "./reminders";
import type {
  BlockStation,
  Exercise,
  GymData,
  SetLog,
  Workout,
  WorkoutBlock,
} from "./types";

export const EX = {
  abductores: "ex-abductores",
  zancadas: "ex-zancadas",
  hatch: "ex-hatch",
  prensa: "ex-prensa",
  femoral: "ex-femoral",
  banca: "ex-banca",
  declinado: "ex-declinado",
  inclinada: "ex-inclinada",
  fondos: "ex-fondos",
  aperturas: "ex-aperturas",
  bulgaras: "ex-bulgaras",
  deadlift: "ex-deadlift",
  hipThrust: "ex-hip-thrust",
  goblet: "ex-goblet",
  absDisco: "ex-abs-disco",
  rodilla: "ex-rodilla",
  oblicuos: "ex-oblicuos",
  laterales: "ex-laterales",
  frontales: "ex-frontales",
  facePull: "ex-face-pull",
  rdl: "ex-rdl",
  smith: "ex-smith",
  extensiones: "ex-extensiones",
  aductores: "ex-aductores",
  gemelos: "ex-gemelos",
  militar: "ex-militar",
  jalon: "ex-jalon",
  invertida: "ex-invertida",
  remoPolea: "ex-remo-polea",
  remoManc: "ex-remo-manc",
  remo: "ex-remo",
  dominadas: "ex-dominadas",
  curl: "ex-curl",
  curlInclinado: "ex-curl-inclinado",
  curlCuerda: "ex-curl-cuerda",
  martillo: "ex-martillo",
  scott: "ex-scott",
  copa: "ex-copa",
  poleaTriceps: "ex-polea-triceps",
  plancha: "ex-plancha",
} as const;

const createdAt = "2026-01-01T00:00:00.000Z";
const LB = 0.45359237;

function kgFromLb(lb: number) {
  return Math.round(lb * LB * 2) / 2;
}

function atDaysAgo(days: number, hour = 18) {
  const d = subDays(new Date(), days);
  d.setHours(hour, 12, 0, 0);
  return d.toISOString();
}

const exercises: Exercise[] = [
  { id: EX.abductores, name: "Abductores", muscleGroup: "legs", equipment: "machine", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.zancadas, name: "Zancadas dobles", muscleGroup: "legs", equipment: "dumbbell", isUnilateral: true, createdByUserId: null, duoId: null },
  { id: EX.hatch, name: "Cuclillas Hack", muscleGroup: "legs", equipment: "machine", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.prensa, name: "Prensa", muscleGroup: "legs", equipment: "machine", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.femoral, name: "Máquina curl de piernas", muscleGroup: "legs", equipment: "machine", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.banca, name: "Press banca", muscleGroup: "chest", equipment: "barbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.declinado, name: "Press declinado", muscleGroup: "chest", equipment: "barbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.inclinada, name: "Press inclinada", muscleGroup: "chest", equipment: "dumbbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.fondos, name: "Fondos", muscleGroup: "chest", equipment: "bodyweight", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.aperturas, name: "Apertura de pecho", muscleGroup: "chest", equipment: "cable", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.bulgaras, name: "Búlgaras", muscleGroup: "legs", equipment: "dumbbell", isUnilateral: true, createdByUserId: null, duoId: null },
  { id: EX.deadlift, name: "Peso muerto", muscleGroup: "legs", equipment: "barbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.hipThrust, name: "Hip thrust", muscleGroup: "legs", equipment: "barbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.goblet, name: "Goblet", muscleGroup: "legs", equipment: "dumbbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.absDisco, name: "Abdominales con disco", muscleGroup: "core", equipment: "other", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.rodilla, name: "Elevación de rodilla", muscleGroup: "core", equipment: "bodyweight", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.oblicuos, name: "Oblicuos", muscleGroup: "core", equipment: "bodyweight", isUnilateral: true, createdByUserId: null, duoId: null },
  { id: EX.laterales, name: "Elevación lateral", muscleGroup: "shoulders", equipment: "dumbbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.frontales, name: "Elevación frontal", muscleGroup: "shoulders", equipment: "dumbbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.facePull, name: "Face pull", muscleGroup: "shoulders", equipment: "cable", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.rdl, name: "Peso muerto rumano", muscleGroup: "legs", equipment: "barbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.smith, name: "Sentadilla Smith", muscleGroup: "legs", equipment: "barbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.extensiones, name: "Extensiones de cuádriceps", muscleGroup: "legs", equipment: "machine", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.aductores, name: "Aductores", muscleGroup: "legs", equipment: "machine", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.gemelos, name: "Gemelos", muscleGroup: "legs", equipment: "machine", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.militar, name: "Press militar", muscleGroup: "shoulders", equipment: "dumbbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.jalon, name: "Jalón al pecho", muscleGroup: "back", equipment: "cable", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.invertida, name: "Invertida", muscleGroup: "back", equipment: "bodyweight", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.remoPolea, name: "Remo polea baja", muscleGroup: "back", equipment: "cable", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.remoManc, name: "Remo unilateral", muscleGroup: "back", equipment: "dumbbell", isUnilateral: true, createdByUserId: null, duoId: null },
  { id: EX.remo, name: "Remo", muscleGroup: "back", equipment: "barbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.dominadas, name: "Dominadas", muscleGroup: "back", equipment: "bodyweight", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.curl, name: "Curl con barra", muscleGroup: "arms", equipment: "barbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.curlInclinado, name: "Curl inclinado", muscleGroup: "arms", equipment: "dumbbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.curlCuerda, name: "Curl con cuerda", muscleGroup: "arms", equipment: "cable", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.martillo, name: "Martillo", muscleGroup: "arms", equipment: "dumbbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.scott, name: "Curl predicador", muscleGroup: "arms", equipment: "other", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.copa, name: "Copa trasnuca", muscleGroup: "arms", equipment: "dumbbell", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.poleaTriceps, name: "Extensión en polea", muscleGroup: "arms", equipment: "cable", isUnilateral: false, createdByUserId: null, duoId: null },
  { id: EX.plancha, name: "Plancha", muscleGroup: "core", equipment: "bodyweight", isUnilateral: false, createdByUserId: null, duoId: null },
];

type LoggedSet = { kg: number | null; reps: number; repsRight?: number | null };

type StraightItem = {
  kind?: "straight";
  exerciseId: string;
  sets: LoggedSet[];
  notes?: string;
};

type CircuitItem = {
  kind: "circuit";
  name: string;
  rounds: { exerciseId: string; kg: number | null; reps: number; repsRight?: number | null }[][];
};

type SessionSpec = {
  id: string;
  userId: string;
  daysAgo: number;
  hour?: number;
  title: string;
  rpe: number;
  notes: string;
  items: Array<StraightItem | CircuitItem>;
};

function nTimes(count: number, kg: number | null, reps: number, repsRight?: number | null): LoggedSet[] {
  return Array.from({ length: count }, () => ({ kg, reps, repsRight }));
}

function buildHistory(specs: SessionSpec[]) {
  const workouts: Workout[] = [];
  const blocks: WorkoutBlock[] = [];
  const stations: BlockStation[] = [];
  const sets: SetLog[] = [];

  for (const spec of specs) {
    const startedAt = atDaysAgo(spec.daysAgo, spec.hour ?? 18);
    const ended = new Date(startedAt);
    ended.setMinutes(ended.getMinutes() + 75);
    workouts.push({
      id: spec.id,
      userId: spec.userId,
      duoId: IDS.duo,
      startedAt,
      endedAt: ended.toISOString(),
      status: "completed",
      notes: spec.notes,
      perceivedExertion: spec.rpe,
      title: spec.title,
    });

    spec.items.forEach((item, i) => {
      const blockId = `${spec.id}-b${i + 1}`;
      if (item.kind === "circuit") {
        const firstRound = item.rounds[0] ?? [];
        blocks.push({
          id: blockId,
          workoutId: spec.id,
          position: i + 1,
          kind: "circuit",
          name: item.name,
          targetRounds: item.rounds.length,
          restBetweenRoundsSec: 90,
          restSec: null,
        });
        firstRound.forEach((station, pos) => {
          const stationId = `${blockId}-s${pos + 1}`;
          stations.push({
            id: stationId,
            blockId,
            exerciseId: station.exerciseId,
            position: pos + 1,
            notes: "En circuito",
          });
          item.rounds.forEach((round, r) => {
            const cell = round[pos] ?? station;
            sets.push({
              id: `${stationId}-r${r + 1}`,
              stationId,
              roundIndex: r + 1,
              setIndex: 1,
              reps: cell.reps,
              repsRight: cell.repsRight ?? null,
              weightKg: cell.kg,
              durationSec: null,
              rpe: null,
              isWarmup: false,
              completed: true,
              loggedAt: startedAt,
            });
          });
        });
        return;
      }

      const stationId = `${blockId}-s1`;
      blocks.push({
        id: blockId,
        workoutId: spec.id,
        position: i + 1,
        kind: "straight",
        name: null,
        targetRounds: 1,
        restBetweenRoundsSec: null,
        restSec: null,
      });
      stations.push({
        id: stationId,
        blockId,
        exerciseId: item.exerciseId,
        position: 1,
        notes: item.notes ?? null,
      });
      item.sets.forEach((row, setIndex) => {
        sets.push({
          id: `${stationId}-${setIndex + 1}`,
          stationId,
          roundIndex: 1,
          setIndex: setIndex + 1,
          reps: row.reps,
          repsRight: row.repsRight ?? null,
          weightKg: row.kg,
          durationSec: null,
          rpe: null,
          isWarmup: false,
          completed: true,
          loggedAt: startedAt,
        });
      });
    });
  }

  return { workouts, blocks, stations, sets };
}

const abductoresHi = kgFromLb(55);
const abductoresLo = kgFromLb(35);
const zancadasKg = kgFromLb(30);
const hatchHi = kgFromLb(100);
const hatchLo = kgFromLb(55);
const bancaCr = kgFromLb(45);
const bancaAm = kgFromLb(55);
const inclinadoKg = kgFromLb(40);
const bulgarasKg = kgFromLb(25);
const muertoKg = kgFromLb(45);
const hipKg = kgFromLb(55);
const gobletKg = kgFromLb(66);
const absKg = kgFromLb(45);
const lateralesKg = kgFromLb(25);
const faceKg = kgFromLb(35);
const curlIncKg = kgFromLb(20);
const martilloKg = kgFromLb(25);
const predicadorKg = kgFromLb(20);

function circuitRounds(
  rounds: number,
  stations: { exerciseId: string; kg: number | null; reps: number; repsRight?: number | null }[],
) {
  return Array.from({ length: rounds }, () => stations);
}

function day1(userId: string, id: string, daysAgo: number, current: boolean): SessionSpec {
  const ab = current ? abductoresHi : abductoresLo;
  const hack = current ? hatchHi : hatchLo;
  const prensaSets = current
    ? [
        { kg: 90, reps: 10 },
        { kg: 115, reps: 8 },
        { kg: 140, reps: 8 },
      ]
    : nTimes(3, 90, 10);
  return {
    id,
    userId,
    daysAgo,
    hour: daysAgo === 0 ? 19 : 18,
    title: "Pierna",
    rpe: current ? 8 : 7,
    notes: current
      ? "Circuito abductores → zancadas → hack. Prensa 90 a 140 kg."
      : "Misma pierna, rango más bajo.",
    items: [
      {
        kind: "circuit",
        name: "Abductores → Zancadas → Hack",
        rounds: circuitRounds(4, [
          { exerciseId: EX.abductores, kg: ab, reps: 18 },
          { exerciseId: EX.zancadas, kg: zancadasKg, reps: 12, repsRight: 12 },
          { exerciseId: EX.hatch, kg: hack, reps: 15 },
        ]),
      },
      { exerciseId: EX.prensa, sets: prensaSets },
      {
        exerciseId: EX.femoral,
        sets: nTimes(3, 25, 12),
        notes: "Combinado. Una pierna 5 kg; ambas 15–25 kg.",
      },
    ],
  };
}

function day2(userId: string, id: string, bancaKg: number, aperturaKg: number): SessionSpec {
  return {
    id,
    userId,
    daysAgo: 2,
    title: "Pecho",
    rpe: 7,
    notes: "Presses y aperturas. Fondos a cuerpo.",
    items: [
      { exerciseId: EX.banca, sets: nTimes(3, bancaKg, 12) },
      { exerciseId: EX.declinado, sets: nTimes(3, bancaKg, 12) },
      { exerciseId: EX.inclinada, sets: nTimes(3, inclinadoKg, 12), notes: "Mancuerna" },
      { exerciseId: EX.fondos, sets: nTimes(3, null, 12), notes: "Peso corporal" },
      { exerciseId: EX.aperturas, sets: nTimes(3, aperturaKg, 12), notes: "Con cuerda" },
    ],
  };
}

function day3(userId: string, id: string): SessionSpec {
  return {
    id,
    userId,
    daysAgo: 4,
    title: "Glúteos",
    rpe: 7,
    notes: "Búlgaras, muerto, hip thrust y goblet.",
    items: [
      { exerciseId: EX.bulgaras, sets: nTimes(3, bulgarasKg, 12, 12), notes: "Mancuerna" },
      { exerciseId: EX.deadlift, sets: nTimes(3, muertoKg, 12) },
      { exerciseId: EX.hipThrust, sets: nTimes(3, hipKg, 12) },
      { exerciseId: EX.goblet, sets: nTimes(3, gobletKg, 12), notes: "Mancuerna" },
    ],
  };
}

function day4(userId: string, id: string): SessionSpec {
  return {
    id,
    userId,
    daysAgo: 5,
    title: "Abdomen y hombros",
    rpe: 6,
    notes: "Abs con disco y hombros con mancuerna.",
    items: [
      { exerciseId: EX.absDisco, sets: nTimes(3, absKg, 20), notes: "Disco" },
      { exerciseId: EX.rodilla, sets: nTimes(3, null, 20), notes: "Máquina de fondos" },
      { exerciseId: EX.oblicuos, sets: nTimes(3, null, 12, 12) },
      { exerciseId: EX.laterales, sets: nTimes(3, lateralesKg, 12), notes: "Mancuerna" },
      { exerciseId: EX.frontales, sets: nTimes(3, lateralesKg, 12), notes: "Mancuerna" },
      { exerciseId: EX.facePull, sets: nTimes(3, faceKg, 12), notes: "Polea" },
    ],
  };
}

function day5(userId: string, id: string, daysAgo = 0): SessionSpec {
  return {
    id,
    userId,
    daysAgo,
    hour: 19,
    title: "Espalda y bíceps",
    rpe: 8,
    notes: "Jalón + invertida en biserie 12+12.",
    items: [
      {
        kind: "circuit",
        name: "Jalón + Invertida",
        rounds: circuitRounds(3, [
          { exerciseId: EX.jalon, kg: 45, reps: 12 },
          { exerciseId: EX.invertida, kg: null, reps: 12 },
        ]),
      },
      { exerciseId: EX.remo, sets: nTimes(3, 45, 12) },
      { exerciseId: EX.remoManc, sets: nTimes(3, 30, 12, 12), notes: "Unilateral" },
      { exerciseId: EX.curlInclinado, sets: nTimes(3, curlIncKg, 12), notes: "Mancuerna" },
      { exerciseId: EX.martillo, sets: nTimes(3, martilloKg, 12), notes: "Mancuerna" },
      { exerciseId: EX.scott, sets: nTimes(3, predicadorKg, 12), notes: "Barra EZ" },
    ],
  };
}

const history = buildHistory([
  day1(IDS.cristian, "w-cr-d1-prev", 7, false),
  day1(IDS.amigo, "w-am-d1-prev", 7, false),
  day4(IDS.cristian, "w-cr-d4"),
  day4(IDS.amigo, "w-am-d4"),
  day3(IDS.cristian, "w-cr-d3"),
  day3(IDS.amigo, "w-am-d3"),
  day2(IDS.cristian, "w-cr-d2", bancaCr, 20),
  day2(IDS.amigo, "w-am-d2", bancaAm, 25),
  day1(IDS.cristian, "w-cr-d1", 1, true),
  day1(IDS.amigo, "w-am-d1", 1, true),
  day5(IDS.cristian, "w-cr-d5", 0),
]);

function load(userId: string, exerciseId: string, weightKg: number, reps: number, repsRight: number | null = null) {
  return [loadKey(userId, exerciseId), { weightKg, reps, repsRight }] as const;
}

const workingLoads: GymData["workingLoads"] = Object.fromEntries([
  load(IDS.cristian, EX.abductores, abductoresHi, 18),
  load(IDS.cristian, EX.zancadas, zancadasKg, 12, 12),
  load(IDS.cristian, EX.hatch, hatchHi, 15),
  load(IDS.cristian, EX.prensa, 140, 8),
  load(IDS.cristian, EX.femoral, 25, 12),
  load(IDS.cristian, EX.banca, bancaCr, 12),
  load(IDS.cristian, EX.declinado, bancaCr, 12),
  load(IDS.cristian, EX.inclinada, inclinadoKg, 12),
  load(IDS.cristian, EX.aperturas, 20, 12),
  load(IDS.cristian, EX.bulgaras, bulgarasKg, 12, 12),
  load(IDS.cristian, EX.deadlift, muertoKg, 12),
  load(IDS.cristian, EX.hipThrust, hipKg, 12),
  load(IDS.cristian, EX.goblet, gobletKg, 12),
  load(IDS.cristian, EX.absDisco, absKg, 20),
  load(IDS.cristian, EX.laterales, lateralesKg, 12),
  load(IDS.cristian, EX.frontales, lateralesKg, 12),
  load(IDS.cristian, EX.facePull, faceKg, 12),
  load(IDS.cristian, EX.jalon, 45, 12),
  load(IDS.cristian, EX.remo, 45, 12),
  load(IDS.cristian, EX.remoManc, 30, 12, 12),
  load(IDS.cristian, EX.curlInclinado, curlIncKg, 12),
  load(IDS.cristian, EX.martillo, martilloKg, 12),
  load(IDS.cristian, EX.scott, predicadorKg, 12),

  load(IDS.amigo, EX.abductores, abductoresHi, 18),
  load(IDS.amigo, EX.zancadas, zancadasKg, 12, 12),
  load(IDS.amigo, EX.hatch, hatchHi, 15),
  load(IDS.amigo, EX.prensa, 140, 8),
  load(IDS.amigo, EX.femoral, 25, 12),
  load(IDS.amigo, EX.banca, bancaAm, 12),
  load(IDS.amigo, EX.declinado, bancaAm, 12),
  load(IDS.amigo, EX.inclinada, inclinadoKg, 12),
  load(IDS.amigo, EX.aperturas, 25, 12),
  load(IDS.amigo, EX.bulgaras, bulgarasKg, 12, 12),
  load(IDS.amigo, EX.deadlift, muertoKg, 12),
  load(IDS.amigo, EX.hipThrust, hipKg, 12),
  load(IDS.amigo, EX.goblet, gobletKg, 12),
  load(IDS.amigo, EX.absDisco, absKg, 20),
  load(IDS.amigo, EX.laterales, lateralesKg, 12),
  load(IDS.amigo, EX.frontales, lateralesKg, 12),
  load(IDS.amigo, EX.facePull, faceKg, 12),
]);

export function createSeed(): GymData {
  return {
    users: [
      {
        id: IDS.cristian,
        email: "cristian@duo.lift",
        displayName: "Cristian",
        avatarHue: 78,
        unitSystem: "kg",
        heightCm: 167,
        weightKg: 60,
        nutritionGoal: "surplus_muscle",
        createdAt,
      },
      {
        id: IDS.amigo,
        email: "duo@duo.lift",
        displayName: "",
        avatarHue: 204,
        unitSystem: "kg",
        heightCm: null,
        weightKg: null,
        nutritionGoal: "surplus_muscle",
        createdAt,
      },
    ],
    duo: { id: IDS.duo, name: "Duo Lift", inviteCode: "GYM2", createdAt },
    members: [
      { duoId: IDS.duo, userId: IDS.cristian, role: "owner", joinedAt: createdAt },
      { duoId: IDS.duo, userId: IDS.amigo, role: "member", joinedAt: createdAt },
    ],
    exercises,
    ...history,
    reactions: [
      {
        id: "rx-am-d1-fire",
        workoutId: "w-cr-d5",
        fromUserId: IDS.amigo,
        kind: "fire",
        body: null,
        createdAt: atDaysAgo(0, 21),
      },
    ],
    workingLoads,
    foodDays: [],
    reminders: DEFAULT_REMINDERS,
  };
}

function isLegacySeedId(id: string) {
  return id.startsWith("w-cr-") || id.startsWith("w-am-") || id.startsWith("rx-");
}

export function stripLegacySeed(data: Partial<GymData>): Partial<GymData> {
  const workouts = (data.workouts ?? []).filter((w) => !isLegacySeedId(w.id));
  const keepWorkouts = new Set(workouts.map((w) => w.id));
  const blocks = (data.blocks ?? []).filter((b) => keepWorkouts.has(b.workoutId));
  const keepBlocks = new Set(blocks.map((b) => b.id));
  const stations = (data.stations ?? []).filter((s) => keepBlocks.has(s.blockId));
  const keepStations = new Set(stations.map((s) => s.id));
  return {
    ...data,
    workouts,
    blocks,
    stations,
    sets: (data.sets ?? []).filter((s) => keepStations.has(s.stationId)),
    reactions: (data.reactions ?? []).filter((r) => keepWorkouts.has(r.workoutId) && !isLegacySeedId(r.id)),
    workingLoads: {},
  };
}

export function mergeGymData(
  existing: Partial<GymData> | undefined,
  seed: GymData,
  opts?: { preferSeedLoads?: boolean },
): GymData {
  const prev = existing ?? {};
  const seedIds = new Set(seed.exercises.map((e) => e.id));
  const custom = (prev.exercises ?? []).filter((e) => !seedIds.has(e.id));
  const exercisesMerged = [
    ...seed.exercises.map((row) => {
      const old = prev.exercises?.find((e) => e.id === row.id);
      return old ? { ...row, createdByUserId: old.createdByUserId, duoId: old.duoId } : row;
    }),
    ...custom,
  ];
  const workingLoadsMerged = opts?.preferSeedLoads
    ? { ...(prev.workingLoads ?? {}), ...seed.workingLoads }
    : { ...seed.workingLoads, ...(prev.workingLoads ?? {}) };

  return {
    ...seed,
    ...prev,
    users: mergeUsers(seed.users, prev.users),
    duo: prev.duo ?? seed.duo,
    members: prev.members?.length ? prev.members : seed.members,
    exercises: exercisesMerged,
    workouts: mergeById(seed.workouts, prev.workouts),
    blocks: mergeById(seed.blocks, prev.blocks),
    stations: mergeById(seed.stations, prev.stations),
    sets: mergeById(seed.sets, prev.sets),
    reactions: mergeById(seed.reactions, prev.reactions),
    workingLoads: workingLoadsMerged,
    foodDays: mergeById(seed.foodDays, prev.foodDays),
    reminders: {
      ...seed.reminders,
      ...(prev.reminders ?? {}),
      lastFired: { ...seed.reminders.lastFired, ...(prev.reminders?.lastFired ?? {}) },
      meals: { ...seed.reminders.meals, ...(prev.reminders?.meals ?? {}) },
      gym: prev.reminders?.gym ?? seed.reminders.gym,
    },
  };
}

function mergeUsers(seed: GymData["users"], existing: GymData["users"] | undefined) {
  const prev = existing ?? [];
  if (prev.length === 0) return seed;
  return prev.map((user) => {
    const fromSeed = seed.find((s) => s.id === user.id);
    const prototypeName = !user.displayName?.trim() || user.displayName.trim().toLowerCase() === "amigo";
    return {
      ...fromSeed,
      ...user,
      displayName: prototypeName ? (fromSeed?.displayName ?? "") : user.displayName,
      heightCm: user.heightCm ?? fromSeed?.heightCm ?? null,
      weightKg: user.weightKg ?? fromSeed?.weightKg ?? null,
      nutritionGoal: user.nutritionGoal ?? fromSeed?.nutritionGoal ?? "surplus_muscle",
    };
  });
}

function mergeById<T extends { id: string }>(incoming: T[], existing: T[] | undefined): T[] {
  const map = new Map<string, T>();
  for (const row of incoming) map.set(row.id, row);
  for (const row of existing ?? []) map.set(row.id, row);
  return [...map.values()];
}
