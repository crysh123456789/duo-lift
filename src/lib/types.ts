export type UnitSystem = "kg" | "lb";
export type MuscleGroup =
  | "legs"
  | "chest"
  | "back"
  | "shoulders"
  | "arms"
  | "core"
  | "other";
export type Equipment =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "bodyweight"
  | "other";
export type WorkoutStatus = "in_progress" | "completed" | "abandoned";
export type BlockKind = "straight" | "circuit" | "rest";
export type ReactionKind = "fire" | "comment";
export type NutritionGoal = "surplus_muscle" | "maintain" | "cut";
export type MealSlot =
  | "desayuno"
  | "mediaManana"
  | "almuerzo"
  | "mediaTarde"
  | "cena";

/** One food inside a meal. kcal is derived (4P + 4C + 9G), not stored. */
export type MealItem = {
  id: string;
  name: string;
  grams: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

/**
 * One of the five slots. Legacy days stored a string in this position;
 * `normalizeMealEntry` turns that string into `note` and leaves items empty.
 */
export type MealEntry = {
  time: string | null;
  items: MealItem[];
  note: string;
};

export type MealLog = Record<MealSlot, MealEntry>;

export type FoodDay = {
  id: string;
  userId: string;
  date: string;
  meals: MealLog;
  comment: string;
  rawInput: string | null;
  updatedAt: string;
};

export type User = {
  id: string;
  email: string;
  displayName: string;
  avatarHue: number;
  unitSystem: UnitSystem;
  heightCm: number | null;
  weightKg: number | null;
  nutritionGoal: NutritionGoal | null;
  createdAt: string;
};

export type Duo = {
  id: string;
  name: string;
  inviteCode: string;
  createdAt: string;
};

export type DuoMember = {
  duoId: string;
  userId: string;
  role: "owner" | "member";
  joinedAt: string;
};

export type Exercise = {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment: Equipment;
  isUnilateral: boolean;
  createdByUserId: string | null;
  duoId: string | null;
};

export type Workout = {
  id: string;
  userId: string;
  duoId: string;
  startedAt: string;
  endedAt: string | null;
  /** Client clock for sync. A date correction must beat an older startedAt. */
  updatedAt?: string;
  status: WorkoutStatus;
  notes: string | null;
  perceivedExertion: number | null;
  title: string | null;
};

export type WorkoutBlock = {
  id: string;
  workoutId: string;
  position: number;
  kind: BlockKind;
  name: string | null;
  targetRounds: number;
  restBetweenRoundsSec: number | null;
  restSec: number | null;
};

export type BlockStation = {
  id: string;
  blockId: string;
  exerciseId: string;
  position: number;
  notes: string | null;
};

export type SetLog = {
  id: string;
  stationId: string;
  roundIndex: number;
  setIndex: number;
  reps: number | null;
  repsRight: number | null;
  weightKg: number | null;
  durationSec: number | null;
  rpe: number | null;
  isWarmup: boolean;
  completed: boolean;
  loggedAt: string;
};

export type Reaction = {
  id: string;
  workoutId: string;
  fromUserId: string;
  kind: ReactionKind;
  body: string | null;
  createdAt: string;
};

export type ReminderSlot = {
  enabled: boolean;
  time: string;
};

export type ReminderSettings = {
  enabled: boolean;
  lastFired: Record<string, string>;
  meals: Record<MealSlot, ReminderSlot>;
  gym: ReminderSlot;
};

export type GymData = {
  users: User[];
  duo: Duo;
  members: DuoMember[];
  exercises: Exercise[];
  workouts: Workout[];
  blocks: WorkoutBlock[];
  stations: BlockStation[];
  sets: SetLog[];
  reactions: Reaction[];
  workingLoads: Record<string, { weightKg: number; reps: number; repsRight: number | null }>;
  foodDays: FoodDay[];
  reminders: ReminderSettings;
};
