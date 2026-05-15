import type { TileState } from "@/types/game";

export type PaidHintId = "definition" | "example" | "pronunciation";

export type HintRevealState = {
  puzzleDate: string;
  definition: boolean;
  example: boolean;
  pronunciation: boolean;
};

function key(storageId: string) {
  return `hangle_hint_reveal_${storageId}`;
}

/** Stable id per UTC calendar day + answer (continuous play). */
export function hintRoundStorageKey(utcDate: string, answerWord: string): string {
  return `${utcDate}__${encodeURIComponent(answerWord)}`;
}

/**
 * Load hint state for this round; migrates legacy `hangle_hint_reveal_${utcDate}` into the
 * composite key once when present.
 */
export function loadHintRevealForRound(utcDate: string, answerWord: string): HintRevealState {
  const composite = hintRoundStorageKey(utcDate, answerWord);
  if (typeof window === "undefined") return defaultHintReveal(composite);
  try {
    const compositeRaw = window.localStorage.getItem(key(composite));
    if (compositeRaw) return loadHintReveal(composite);
    const legacyRaw = window.localStorage.getItem(key(utcDate));
    if (!legacyRaw) return defaultHintReveal(composite);
    const p = JSON.parse(legacyRaw) as Partial<HintRevealState>;
    const migrated: HintRevealState = {
      puzzleDate: composite,
      definition: Boolean(p.definition),
      example: Boolean(p.example),
      pronunciation: Boolean(p.pronunciation),
    };
    saveHintReveal(migrated);
    window.localStorage.removeItem(key(utcDate));
    return migrated;
  } catch {
    return defaultHintReveal(composite);
  }
}

export function defaultHintReveal(puzzleDate: string): HintRevealState {
  return {
    puzzleDate,
    definition: false,
    example: false,
    pronunciation: false,
  };
}

export function loadHintReveal(puzzleDate: string): HintRevealState {
  if (typeof window === "undefined") return defaultHintReveal(puzzleDate);
  try {
    const raw = localStorage.getItem(key(puzzleDate));
    if (!raw) return defaultHintReveal(puzzleDate);
    const p = JSON.parse(raw) as Partial<HintRevealState>;
    if (p.puzzleDate !== puzzleDate) return defaultHintReveal(puzzleDate);
    return {
      puzzleDate,
      definition: Boolean(p.definition),
      example: Boolean(p.example),
      pronunciation: Boolean(p.pronunciation),
    };
  } catch {
    return defaultHintReveal(puzzleDate);
  }
}

export function saveHintReveal(state: HintRevealState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key(state.puzzleDate), JSON.stringify(state));
}

/** Reset paid hints for this puzzle date (e.g. same-day replay). */
export function resetHintReveal(puzzleDate: string): HintRevealState {
  const next = defaultHintReveal(puzzleDate);
  saveHintReveal(next);
  return next;
}

export function revealHint(
  prev: HintRevealState,
  id: PaidHintId,
): HintRevealState {
  const next = { ...prev, [id]: true };
  saveHintReveal(next);
  return next;
}

export function countRevealedPaidHints(s: HintRevealState): number {
  return (s.definition ? 1 : 0) + (s.example ? 1 : 0) + (s.pronunciation ? 1 : 0);
}

/** Wordle-style emoji rows for share / result (only submitted rows). */
export function evaluationsToEmojiLines(
  evaluations: TileState[][],
  answerLength: number,
): string {
  return evaluations
    .filter((row) => row.length === answerLength)
    .map((row) => row.map((t) => (t === "correct" ? "🟩" : t === "present" ? "🟨" : "⬜")).join(""))
    .join("\n");
}
