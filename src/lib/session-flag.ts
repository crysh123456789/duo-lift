let unlocked = true;

export function setDuoUnlocked(value: boolean) {
  unlocked = value;
}

export function duoUnlocked() {
  return unlocked;
}
