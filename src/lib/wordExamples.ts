import type { WordExampleContext, WordExampleEntry } from "@/types/game";

/** Emoji shown before each example line on the result screen */
export const CONTEXT_EMOJI: Record<WordExampleContext, string> = {
  "K-drama": "🎬",
  "K-pop": "🎵",
  Daily: "💬",
  Formal: "👔",
  Casual: "😊",
};

export function isWordExampleContext(s: string): s is WordExampleContext {
  return (
    s === "K-drama" ||
    s === "K-pop" ||
    s === "Daily" ||
    s === "Formal" ||
    s === "Casual"
  );
}

/** First example row for masked hint during play: "한국어 (English)" */
export function formatExampleHintLine(ex: WordExampleEntry | undefined): string {
  if (!ex) return "";
  const k = ex.korean?.trim() ?? "";
  const e = ex.english?.trim() ?? "";
  if (!k && !e) return "";
  if (!e) return k;
  if (!k) return e;
  return `${k} (${e})`;
}

export function getWordExamples(entry: { examples?: WordExampleEntry[] } | null | undefined): WordExampleEntry[] {
  const list = entry?.examples;
  if (!Array.isArray(list) || list.length === 0) return [];
  return list.filter(
    (x) =>
      x &&
      typeof x.korean === "string" &&
      x.korean.trim() !== "" &&
      typeof x.english === "string" &&
      x.english.trim() !== "" &&
      typeof x.context === "string" &&
      isWordExampleContext(x.context),
  );
}
