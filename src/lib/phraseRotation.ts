import type { PhraseEntry } from "@/types/phrase";

/** Seen phrase IDs for rotation (unseen preferred until pool exhausted). */
export const HANGLE_SEEN_PHRASES_KEY = "hangle_seen_phrases";

function readSeenIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HANGLE_SEEN_PHRASES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is number => typeof x === "number" && Number.isFinite(x))
      : [];
  } catch {
    return [];
  }
}

function writeSeenIds(ids: number[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HANGLE_SEEN_PHRASES_KEY, JSON.stringify(ids.slice(-500)));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Pick a phrase for the end-of-game bonus card.
 * Prefers IDs not in `hangle_seen_phrases`; when all seen, clears list and picks from full pool.
 * Persists the chosen id to seen list.
 */
export function getNextPhrase(phrases: readonly PhraseEntry[]): PhraseEntry {
  if (!phrases.length) {
    throw new Error("phrases.json is empty");
  }
  let seen = readSeenIds();
  const unseen = phrases.filter((p) => !seen.includes(p.id));
  let pool: readonly PhraseEntry[] = unseen;

  if (unseen.length === 0) {
    writeSeenIds([]);
    seen = [];
    pool = phrases;
  }

  const pick = pool[Math.floor(Math.random() * pool.length)]!;
  const nextSeen = [...seen, pick.id];
  writeSeenIds(nextSeen);
  return pick;
}
