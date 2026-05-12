import type { WordEntry } from "@/types/game";

/** YYYY-MM-DD in UTC */
export function getUtcDateString(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getUtcDayNumber(d = new Date()): number {
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000,
  );
}

/** Daily index maps to `words.json` order (UTC day number mod length). Answers are always `entry.word`. */
export function pickDailyWord(words: WordEntry[], dayNumber = getUtcDayNumber()): WordEntry {
  if (words.length === 0) throw new Error("words list is empty");
  return words[dayNumber % words.length]!;
}

/**
 * Random practice word: not today's daily, avoids `solved` until exhausted, then clears `solved` tracking.
 */
export function pickPracticeWord(
  words: WordEntry[],
  solved: readonly string[],
  dailyAnswer: string,
): { entry: WordEntry; clearedSolved: boolean } {
  if (words.length === 0) throw new Error("words list is empty");
  const solvedSet = new Set(solved);
  let clearedSolved = false;
  let pool = words.filter((w) => w.word !== dailyAnswer && !solvedSet.has(w.word));
  if (pool.length === 0) {
    clearedSolved = true;
    pool = words.filter((w) => w.word !== dailyAnswer);
  }
  if (pool.length === 0) {
    pool = [...words];
  }
  const entry = pool[Math.floor(Math.random() * pool.length)]!;
  return { entry, clearedSolved };
}

/** JSON `length` 또는 문자 길이 */
export function entrySyllableCount(entry: Pick<WordEntry, "word" | "length">): number {
  return typeof entry.length === "number" ? entry.length : entry.word.length;
}

/** 모든 글자가 완성형 한글 음절이며 개수가 기대값과 같은지 */
export function isFullHangulWord(s: string, syllableCount: number): boolean {
  if (s.length !== syllableCount) return false;
  for (let i = 0; i < syllableCount; i++) {
    const c = s.charAt(i)!;
    if (c < "\uAC00" || c > "\uD7A3") return false;
  }
  return true;
}
