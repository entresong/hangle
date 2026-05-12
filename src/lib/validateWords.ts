import type { WordEntry } from "@/types/game";
import { getWordExamples, isWordExampleContext } from "@/lib/wordExamples";

const REQUIRED_FIELDS = ["word", "meaning", "definition", "examples", "emoji", "category"] as const;

/** Runtime check for words.json shape (every entry needs display + hint fields). */
export function validateWordEntries(words: readonly WordEntry[]): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const w of words) {
    const id =
      typeof w.word === "string" && w.word.trim() !== "" ? w.word : "?";
    for (const key of REQUIRED_FIELDS) {
      const v = w[key as keyof WordEntry];
      if (key === "examples") {
        const list = getWordExamples(w);
        if (list.length < 2 || list.length > 3) {
          issues.push(`${id}: 'examples' must have 2–3 valid items (got ${list.length})`);
        }
        for (let i = 0; i < (Array.isArray(w.examples) ? w.examples.length : 0); i++) {
          const ex = w.examples![i];
          if (!ex || typeof ex !== "object") {
            issues.push(`${id}: examples[${i}] invalid`);
            continue;
          }
          if (typeof ex.korean !== "string" || ex.korean.trim() === "") {
            issues.push(`${id}: examples[${i}].korean missing`);
          }
          if (typeof ex.english !== "string" || ex.english.trim() === "") {
            issues.push(`${id}: examples[${i}].english missing`);
          }
          if (typeof ex.context !== "string" || !isWordExampleContext(ex.context)) {
            issues.push(`${id}: examples[${i}].context must be K-drama|K-pop|Daily|Formal|Casual`);
          }
        }
        continue;
      }
      if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
        issues.push(`${id}: missing or empty '${key}'`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
