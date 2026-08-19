export function nid(): string {
  return crypto.randomUUID();
}

export const IDS = {
  cristian: "user-cristian",
  amigo: "user-amigo",
  duo: "duo-1",
} as const;
