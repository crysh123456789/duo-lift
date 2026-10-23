/** Profile and claim constants. Identity is auth.uid(), never these labels. */

export const MIN_PASSWORD_LENGTH = 8;

export const LEGACY_HISTORIES = [
  { key: "cristian", userId: "user-cristian", label: "Historial de Cristian" },
  { key: "kviedes", userId: "user-amigo", label: "Historial de Kviedes" },
] as const;

export type LegacyKey = (typeof LEGACY_HISTORIES)[number]["key"];
export type HistoryChoice = LegacyKey | "clean";

const AUTH_USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isLegacyKey(value: string): value is LegacyKey {
  return LEGACY_HISTORIES.some((row) => row.key === value);
}

export function legacyUserId(key: LegacyKey): string {
  return LEGACY_HISTORIES.find((row) => row.key === key)!.userId;
}

export function isAuthUserId(value: string | null | undefined): boolean {
  return Boolean(value && AUTH_USER_ID.test(value));
}
