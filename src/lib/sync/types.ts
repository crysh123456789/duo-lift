export const TOMBSTONE_ENTITIES = [
  "workouts",
  "blocks",
  "stations",
  "sets",
  "reactions",
  "exercises",
  "foodDays",
  "workingLoads",
  "members",
  "mealItems",
] as const;

export type TombstoneEntity = (typeof TOMBSTONE_ENTITIES)[number];

export type Tombstone = {
  entity: TombstoneEntity;
  id: string;
};

export function isTombstoneEntity(value: string): value is TombstoneEntity {
  return (TOMBSTONE_ENTITIES as readonly string[]).includes(value);
}
