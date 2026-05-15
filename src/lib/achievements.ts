/**
 * Achievement system + attempt grading for Hangle.
 *
 * Achievements are pure predicates over `PersistedStats` + the master `WordEntry`
 * list — no extra persistence required. To detect "newly unlocked this round"
 * we diff the predicate set before vs. after `mergeStatsAfterGameEnd`.
 *
 * Honesty policy: every threshold here can actually be achieved against
 * the current 100-word data set. No "come back tomorrow" promises.
 */

import type { PersistedStats, WordEntry } from "@/types/game";

export type AchievementGroup =
  | "progress"
  | "category"
  | "speed"
  | "consistency"
  | "learning";

export type AchievementCtx = {
  stats: PersistedStats;
  /** Master word list (used for category totals) */
  words: WordEntry[];
  /** Total available words per category (uppercase keys) */
  wordsByCat: Map<string, number>;
  /** Distinct learned (won) words per category (uppercase keys) */
  learnedByCat: Map<string, number>;
  /** Wins that finished in 3 guesses or fewer (sum of guessDistribution[0..2]) */
  winsIn3OrFewer: number;
};

export type AchievementDef = {
  id: string;
  emoji: string;
  title: string;
  /** One-line learner-facing requirement */
  description: string;
  group: AchievementGroup;
  /** True when the player currently qualifies */
  check: (ctx: AchievementCtx) => boolean;
  /** Optional progress (0–100) for locked badges — for "X more to go" UI */
  progress?: (ctx: AchievementCtx) => { value: number; target: number };
};

/** Ordered for display — group sections, easier → harder within each group */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // ── Progress (word count) ────────────────────────────────────────────
  {
    id: "first_word",
    emoji: "🌱",
    title: "First Word",
    description: "Solve your first Korean word",
    group: "progress",
    check: (c) => (c.stats.wordsLearned ?? []).length >= 1,
    progress: (c) => ({ value: (c.stats.wordsLearned ?? []).length, target: 1 }),
  },
  {
    id: "sprout",
    emoji: "🌿",
    title: "Sprout",
    description: "Learn 5 words",
    group: "progress",
    check: (c) => (c.stats.wordsLearned ?? []).length >= 5,
    progress: (c) => ({ value: (c.stats.wordsLearned ?? []).length, target: 5 }),
  },
  {
    id: "growing",
    emoji: "🌳",
    title: "Growing",
    description: "Learn 20 words",
    group: "progress",
    check: (c) => (c.stats.wordsLearned ?? []).length >= 20,
    progress: (c) => ({ value: (c.stats.wordsLearned ?? []).length, target: 20 }),
  },
  {
    id: "forest",
    emoji: "🌲",
    title: "Forest",
    description: "Learn 50 words",
    group: "progress",
    check: (c) => (c.stats.wordsLearned ?? []).length >= 50,
    progress: (c) => ({ value: (c.stats.wordsLearned ?? []).length, target: 50 }),
  },
  {
    id: "centurion",
    emoji: "🏔️",
    title: "Centurion",
    description: "Learn 100 words",
    group: "progress",
    check: (c) => (c.stats.wordsLearned ?? []).length >= 100,
    progress: (c) => ({ value: (c.stats.wordsLearned ?? []).length, target: 100 }),
  },

  // ── Category specialists ─────────────────────────────────────────────
  {
    id: "food_lover",
    emoji: "🍔",
    title: "Food Lover",
    description: "Learn 5 FOOD words",
    group: "category",
    check: (c) => (c.learnedByCat.get("FOOD") ?? 0) >= 5,
    progress: (c) => ({ value: c.learnedByCat.get("FOOD") ?? 0, target: 5 }),
  },
  {
    id: "heart_reader",
    emoji: "❤️",
    title: "Heart Reader",
    description: "Learn 5 EMOTION words",
    group: "category",
    check: (c) => (c.learnedByCat.get("EMOTION") ?? 0) >= 5,
    progress: (c) => ({ value: c.learnedByCat.get("EMOTION") ?? 0, target: 5 }),
  },
  {
    id: "naturalist",
    emoji: "🌸",
    title: "Naturalist",
    description: "Learn 5 NATURE words",
    group: "category",
    check: (c) => (c.learnedByCat.get("NATURE") ?? 0) >= 5,
    progress: (c) => ({ value: c.learnedByCat.get("NATURE") ?? 0, target: 5 }),
  },
  {
    id: "time_traveler",
    emoji: "⏰",
    title: "Time Traveler",
    description: "Learn 5 TIME words",
    group: "category",
    check: (c) => (c.learnedByCat.get("TIME") ?? 0) >= 5,
    progress: (c) => ({ value: c.learnedByCat.get("TIME") ?? 0, target: 5 }),
  },
  {
    id: "concept_sage",
    emoji: "🎭",
    title: "Concept Sage",
    description: "Learn 5 CONCEPT words",
    group: "category",
    check: (c) => (c.learnedByCat.get("CONCEPT") ?? 0) >= 5,
    progress: (c) => ({ value: c.learnedByCat.get("CONCEPT") ?? 0, target: 5 }),
  },

  // ── Speed / accuracy ─────────────────────────────────────────────────
  {
    id: "speed_runner",
    emoji: "⚡",
    title: "Speed Runner",
    description: "Solve in 1 guess 5 times",
    group: "speed",
    check: (c) => (c.stats.oneGuessWins ?? 0) >= 5,
    progress: (c) => ({ value: c.stats.oneGuessWins ?? 0, target: 5 }),
  },
  {
    id: "sharpshooter",
    emoji: "🎯",
    title: "Sharpshooter",
    description: "Win in 3 tries or fewer · 10 times",
    group: "speed",
    check: (c) => c.winsIn3OrFewer >= 10,
    progress: (c) => ({ value: c.winsIn3OrFewer, target: 10 }),
  },

  // ── Consistency ──────────────────────────────────────────────────────
  {
    id: "hot_streak",
    emoji: "🔥",
    title: "Hot Streak",
    description: "Reach a 5-day win streak",
    group: "consistency",
    check: (c) => c.stats.maxStreak >= 5,
    progress: (c) => ({ value: c.stats.maxStreak, target: 5 }),
  },
  {
    id: "marathon",
    emoji: "💪",
    title: "Marathon",
    description: "Play 20 games (any mode)",
    group: "consistency",
    check: (c) => c.stats.gamesPlayed >= 20,
    progress: (c) => ({ value: c.stats.gamesPlayed, target: 20 }),
  },

  // ── Learning breadth ─────────────────────────────────────────────────
  {
    id: "phrase_lover",
    emoji: "📚",
    title: "Phrase Lover",
    description: "See 10 bonus phrases",
    group: "learning",
    check: (c) => (c.stats.phrasesLearned ?? []).length >= 10,
    progress: (c) => ({ value: (c.stats.phrasesLearned ?? []).length, target: 10 }),
  },
] as const;

export function buildAchievementCtx(
  stats: PersistedStats,
  words: WordEntry[],
): AchievementCtx {
  const wordsByCat = new Map<string, number>();
  for (const w of words) {
    const cat = (w.category ?? "").toUpperCase();
    if (!cat) continue;
    wordsByCat.set(cat, (wordsByCat.get(cat) ?? 0) + 1);
  }

  const learnedSet = new Set(stats.wordsLearned ?? []);
  const learnedByCat = new Map<string, number>();
  for (const w of words) {
    if (!learnedSet.has(w.word)) continue;
    const cat = (w.category ?? "").toUpperCase();
    if (!cat) continue;
    learnedByCat.set(cat, (learnedByCat.get(cat) ?? 0) + 1);
  }

  const dist = stats.guessDistribution ?? [0, 0, 0, 0, 0, 0];
  const winsIn3OrFewer = (dist[0] ?? 0) + (dist[1] ?? 0) + (dist[2] ?? 0);

  return { stats, words, wordsByCat, learnedByCat, winsIn3OrFewer };
}

export function getUnlockedAchievementIds(
  stats: PersistedStats,
  words: WordEntry[],
): Set<string> {
  const ctx = buildAchievementCtx(stats, words);
  const set = new Set<string>();
  for (const a of ACHIEVEMENTS) {
    if (a.check(ctx)) set.add(a.id);
  }
  return set;
}

/** Achievements unlocked between `prev` and `next` (for celebration UI). */
export function getNewlyUnlocked(
  prev: PersistedStats,
  next: PersistedStats,
  words: WordEntry[],
): AchievementDef[] {
  const prevSet = getUnlockedAchievementIds(prev, words);
  const nextSet = getUnlockedAchievementIds(next, words);
  return ACHIEVEMENTS.filter((a) => !prevSet.has(a.id) && nextSet.has(a.id));
}

export type AttemptGrade = {
  /** 0–6 stars; 0 means failed */
  stars: number;
  title: string;
  /** Optional flair emoji prepended to the title (e.g. "🏆") */
  emoji?: string;
};

export function getAttemptGrade(tries: number, won: boolean): AttemptGrade {
  if (!won) return { stars: 0, title: "Better luck next time!" };
  switch (tries) {
    case 1:
      return { stars: 6, title: "GENIUS!", emoji: "🏆" };
    case 2:
      return { stars: 5, title: "Excellent!" };
    case 3:
      return { stars: 4, title: "Great!" };
    case 4:
      return { stars: 3, title: "Good!" };
    case 5:
      return { stars: 2, title: "Solid!" };
    case 6:
      return { stars: 1, title: "Made it!" };
    default:
      return { stars: 0, title: "Solved!" };
  }
}

/** Category progress rows for UI rendering (sorted: in-progress first, then untouched) */
export type CategoryProgressRow = {
  category: string;
  learned: number;
  total: number;
  percent: number;
};

export function getCategoryProgress(
  stats: PersistedStats,
  words: WordEntry[],
): CategoryProgressRow[] {
  const { wordsByCat, learnedByCat } = buildAchievementCtx(stats, words);
  const rows: CategoryProgressRow[] = [];
  for (const [cat, total] of wordsByCat.entries()) {
    const learned = learnedByCat.get(cat) ?? 0;
    const percent = total > 0 ? Math.round((learned / total) * 100) : 0;
    rows.push({ category: cat, learned, total, percent });
  }
  rows.sort((a, b) => {
    const ai = a.learned > 0 && a.learned < a.total ? 0 : a.learned >= a.total ? 1 : 2;
    const bi = b.learned > 0 && b.learned < b.total ? 0 : b.learned >= b.total ? 1 : 2;
    if (ai !== bi) return ai - bi;
    return b.percent - a.percent;
  });
  return rows;
}
