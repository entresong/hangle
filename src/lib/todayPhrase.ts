import type { PhraseEntry } from "@/types/phrase";

/** Same calendar phrase for all users in UTC (epoch day). */
export function pickTodayPhrase(phrases: readonly PhraseEntry[], now = Date.now()): PhraseEntry {
  if (!phrases.length) {
    throw new Error("phrases.json is empty");
  }
  const dayIndex = Math.floor(now / 86400000) % phrases.length;
  return phrases[dayIndex]!;
}
