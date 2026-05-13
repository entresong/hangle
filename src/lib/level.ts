/**
 * Learning level + welcome-message logic for the Korean Journey panel.
 *
 * Levels are based on the number of *distinct* Korean words the user has
 * actually won (across daily + practice modes). Phrases and bonus content
 * are tracked separately and do not affect the level.
 */

export type LevelName =
  | "Beginner"
  | "Elementary"
  | "Intermediate"
  | "Advanced"
  | "Master";

export type LevelTier = {
  name: LevelName;
  min: number;
  emoji: string;
};

export const LEVEL_TIERS: readonly LevelTier[] = [
  { name: "Beginner", min: 0, emoji: "🌱" },
  { name: "Elementary", min: 20, emoji: "📖" },
  { name: "Intermediate", min: 50, emoji: "🎯" },
  { name: "Advanced", min: 100, emoji: "🚀" },
  { name: "Master", min: 200, emoji: "👑" },
] as const;

export type LevelInfo = {
  current: LevelName;
  emoji: string;
  /** Word threshold for the current tier */
  currentMin: number;
  /** Next tier name, or null if already at top */
  nextLevel: LevelName | null;
  /** Word threshold for the next tier, or null at top */
  nextMin: number | null;
  /** Words remaining to next tier (0 at top tier) */
  wordsToNext: number;
  /** Progress within current tier, 0–100 (always 100 at top tier) */
  progressPercent: number;
  /** Word count passed in */
  totalWords: number;
};

export function getLevelInfo(wordCount: number): LevelInfo {
  const safe = Math.max(0, Math.floor(wordCount));
  let currentIdx = 0;
  for (let i = LEVEL_TIERS.length - 1; i >= 0; i--) {
    if (safe >= LEVEL_TIERS[i]!.min) {
      currentIdx = i;
      break;
    }
  }
  const current = LEVEL_TIERS[currentIdx]!;
  const next = LEVEL_TIERS[currentIdx + 1] ?? null;

  if (!next) {
    return {
      current: current.name,
      emoji: current.emoji,
      currentMin: current.min,
      nextLevel: null,
      nextMin: null,
      wordsToNext: 0,
      progressPercent: 100,
      totalWords: safe,
    };
  }

  const span = next.min - current.min;
  const intoTier = safe - current.min;
  const percent = span > 0 ? Math.min(100, Math.round((intoTier / span) * 100)) : 0;

  return {
    current: current.name,
    emoji: current.emoji,
    currentMin: current.min,
    nextLevel: next.name,
    nextMin: next.min,
    wordsToNext: Math.max(0, next.min - safe),
    progressPercent: percent,
    totalWords: safe,
  };
}

/**
 * Welcome message keyed on visit count *before* the current bump.
 * - 0  → first ever launch
 * - 1  → second launch
 * - <5 → returning early
 * - <10 → regular
 * - 10+ → power user
 */
export function welcomeMessage(visitsBeforeBump: number): string {
  if (visitsBeforeBump <= 0) return "Welcome to Hangle! 🇰🇷";
  if (visitsBeforeBump === 1) return "Welcome back! 🎉";
  if (visitsBeforeBump < 5) return "Glad you're back! 🌱";
  if (visitsBeforeBump < 10) return "Hangle regular! 🔥";
  return "Hangle master in training! 👑";
}
