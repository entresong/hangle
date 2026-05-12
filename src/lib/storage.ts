import type { PersistedGame, PersistedStats } from "@/types/game";
import { getUtcDateString } from "./dailyWord";

const GAME_KEY = "hangle_game_v1";
const STATS_KEY = "hangle_stats_v1";

export const defaultStats = (): PersistedStats => ({
  gamesPlayed: 0,
  gamesWon: 0,
  guessDistribution: [0, 0, 0, 0, 0, 0],
  currentStreak: 0,
  maxStreak: 0,
  totalGuessesOnWins: 0,
  lastCompletedPuzzleDate: null,
  utcStatsDate: null,
  gamesFinishedToday: 0,
  practiceSolvedWords: [],
  oneGuessWins: 0,
});

export function loadGame(): PersistedGame | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(GAME_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedGame;
  } catch {
    return null;
  }
}

export function saveGame(state: PersistedGame): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GAME_KEY, JSON.stringify(state));
}

export function loadStats(): PersistedStats {
  if (typeof window === "undefined") return defaultStats();
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return defaultStats();
    const today = getUtcDateString();
    const merged = { ...defaultStats(), ...JSON.parse(raw) } as PersistedStats;
    if ((merged.utcStatsDate ?? null) !== today) {
      return { ...merged, utcStatsDate: today, gamesFinishedToday: 0 };
    }
    return merged;
  } catch {
    return defaultStats();
  }
}

export function saveStats(stats: PersistedStats): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

/** UTC calendar day difference: to - from */
export function utcDayDiff(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  const fromN = Math.floor(Date.UTC(fy!, fm! - 1, fd!) / 86400000);
  const toN = Math.floor(Date.UTC(ty!, tm! - 1, td!) / 86400000);
  return toN - fromN;
}

/** Daily puzzles affect streak / last-completed; practice rounds only affect aggregate stats. */
export type GameEndKind = "daily" | "practice";

export function appendPracticeClearedWord(
  stats: PersistedStats,
  word: string,
): PersistedStats {
  const arr = [...(stats.practiceSolvedWords ?? [])];
  if (!arr.includes(word)) arr.push(word);
  return { ...stats, practiceSolvedWords: arr };
}

export function resetPracticeSolvedPool(stats: PersistedStats): PersistedStats {
  return { ...stats, practiceSolvedWords: [] };
}

export function mergeStatsAfterGameEnd(
  prev: PersistedStats,
  won: boolean,
  guessCount: number,
  kind: GameEndKind = "daily",
): PersistedStats {
  const today = getUtcDateString();
  const prevFinishedToday =
    prev.utcStatsDate === today ? (prev.gamesFinishedToday ?? 0) : 0;

  const next: PersistedStats = {
    ...prev,
    gamesPlayed: prev.gamesPlayed + 1,
    gamesWon: prev.gamesWon + (won ? 1 : 0),
    guessDistribution: [...prev.guessDistribution] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    utcStatsDate: today,
    gamesFinishedToday: prevFinishedToday + 1,
  };

  if (won && guessCount >= 1 && guessCount <= 6) {
    next.guessDistribution[guessCount - 1]! += 1;
    next.totalGuessesOnWins = prev.totalGuessesOnWins + guessCount;
  }
  if (won && guessCount === 1) {
    next.oneGuessWins = (prev.oneGuessWins ?? 0) + 1;
  }

  if (kind === "practice") {
    return next;
  }

  if (!won) {
    next.currentStreak = 0;
    next.lastCompletedPuzzleDate = today;
    return next;
  }

  const last = prev.lastCompletedPuzzleDate;
  let streak = 1;
  if (last) {
    const diff = utcDayDiff(last, today);
    if (diff === 0) streak = prev.currentStreak;
    else if (diff === 1) streak = prev.currentStreak + 1;
    else streak = 1;
  }
  next.currentStreak = streak;
  next.maxStreak = Math.max(prev.maxStreak, streak);
  next.lastCompletedPuzzleDate = today;
  return next;
}
