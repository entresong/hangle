import type { WordEntry } from "@/types/game";

const REQUIRED_FIELDS = ["word", "meaning", "definition", "example", "emoji", "category"] as const;

/** Runtime check for words.json shape (every entry needs display + hint fields). */
export function validateWordEntries(words: readonly WordEntry[]): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const w of words) {
    const id =
      typeof w.word === "string" && w.word.trim() !== "" ? w.word : "?";
    for (const key of REQUIRED_FIELDS) {
      const v = w[key as keyof WordEntry];
      if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
        issues.push(`${id}: missing or empty '${key}'`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
