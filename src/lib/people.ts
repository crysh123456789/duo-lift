import type { User } from "./types";

const BANNED_NAMES = new Set(["amigo", "el otro", "perfil 1", "perfil 2"]);

export function personName(user: User | undefined): string {
  const raw = user?.displayName?.trim() ?? "";
  if (!raw || BANNED_NAMES.has(raw.toLowerCase())) return "";
  return raw;
}

export function personInitial(user: User | undefined): string {
  const name = personName(user);
  return name ? name.slice(0, 1).toUpperCase() : "?";
}

export function duoLine(users: User[]): string {
  const names = users.map(personName).filter(Boolean);
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 1) return names[0]!;
  return "Duo Lift";
}
