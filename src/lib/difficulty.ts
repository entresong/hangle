export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTY_STORAGE_KEY = "hangle_difficulty";

export function isDifficulty(v: unknown): v is Difficulty {
  return v === "easy" || v === "normal" || v === "hard";
}

/** null = never chosen (show onboarding) */
export function loadDifficulty(): Difficulty | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
    return isDifficulty(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveDifficulty(d: Difficulty): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DIFFICULTY_STORAGE_KEY, d);
}

export function shareDifficultySuffix(d: Difficulty): string {
  if (d === "easy") return "(EASY) 🟢";
  if (d === "normal") return "(NORMAL) 🟡";
  return "(HARD) 🔴";
}

export function difficultyBadgeLabel(d: Difficulty): string {
  if (d === "easy") return "🟢 EASY";
  if (d === "normal") return "🟡 NORMAL";
  return "🔴 HARD";
}
