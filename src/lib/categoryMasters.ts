import type { PersistedStats, WordEntry } from "@/types/game";
import { getCategoryProgress } from "@/lib/achievements";

/** Categories that became 100% learned this round (was not complete → complete). */
export function getNewlyCompletedCategories(
  prev: PersistedStats,
  next: PersistedStats,
  words: WordEntry[],
): string[] {
  const prevRows = getCategoryProgress(prev, words);
  const nextRows = getCategoryProgress(next, words);
  const out: string[] = [];
  for (const nr of nextRows) {
    if (nr.total <= 0) continue;
    const pr = prevRows.find((r) => r.category === nr.category);
    const prevLearned = pr?.learned ?? 0;
    if (prevLearned < nr.total && nr.learned >= nr.total) {
      out.push(nr.category);
    }
  }
  return out;
}

/**
 * True the first time every word tagged K-POP in the corpus has been won.
 */
export function isNewlyKpopTagCorpusMaster(
  prev: PersistedStats,
  next: PersistedStats,
  words: WordEntry[],
): boolean {
  const kpop = words.filter((w) => Array.isArray(w.tags) && w.tags.includes("K-POP"));
  if (kpop.length === 0) return false;
  const prevS = new Set(prev.wordsLearned ?? []);
  const nextS = new Set(next.wordsLearned ?? []);
  const wasDone = kpop.every((w) => prevS.has(w.word));
  const nowDone = kpop.every((w) => nextS.has(w.word));
  return !wasDone && nowDone;
}
