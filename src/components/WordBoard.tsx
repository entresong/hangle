"use client";

import type { TileState } from "@/types/game";
import { assembleBuffer, parseAssembled } from "@/lib/hangulBuffer";

const tileClass: Record<TileState, string> = {
  correct: "bg-emerald-500 border-emerald-600 text-white",
  present: "bg-amber-400 border-amber-500 text-white",
  absent: "bg-stone-400 border-stone-500 text-white",
};

/** Small tiles for locked past guesses (~½ active size). */
const prevCell =
  "flex h-8 w-8 min-h-[30px] min-w-[30px] shrink-0 items-center justify-center rounded border text-[0.95rem] font-semibold leading-none max-[480px]:h-[30px] max-[480px]:w-[30px] max-[480px]:min-h-[30px] max-[480px]:min-w-[30px] max-[480px]:text-[0.9rem] sm:h-8 sm:w-8";

/** Large active row — 2× previous cell size. */
const activeCellBase =
  "flex h-16 w-16 min-h-[60px] min-w-[60px] shrink-0 items-center justify-center rounded-lg border-2 text-[1.65rem] font-semibold leading-none shadow-md max-[480px]:h-[62px] max-[480px]:w-[62px] max-[480px]:min-h-[62px] max-[480px]:min-w-[62px] max-[480px]:text-[1.55rem] sm:h-16 sm:w-16 sm:text-[1.75rem]";

type WordBoardProps = {
  guesses: string[];
  evaluations: TileState[][];
  currentRow: number;
  buffer: string[];
  shakeRow: number | null;
  draftFlashRed?: boolean;
  suppressDraft?: boolean;
  status: "playing" | "won" | "lost";
  answerLength: number;
  /** When false, only past guesses render (e.g. edge cases). */
  showActiveRow?: boolean;
};

function buildDraftCells(
  cols: number,
  syllables: string[],
  trailing: string,
): { char: string; draft: boolean }[] {
  const cells = Array.from({ length: cols }, () => ({
    char: "",
    draft: true as boolean,
  }));

  const n = syllables.length;
  for (let i = 0; i < Math.min(n, cols); i++) {
    cells[i]!.char = syllables[i] ?? "";
    cells[i]!.draft = true;
  }
  if (n < cols && trailing) {
    cells[n]!.char = (cells[n]!.char ?? "") + trailing;
    cells[n]!.draft = true;
  }

  return cells;
}

function activeDraftFocusIndex(cols: number, syllables: string[]): number {
  const n = syllables.length;
  if (n === 0) return 0;
  if (n < cols) return n;
  return cols - 1;
}

export function WordBoard({
  guesses,
  evaluations,
  currentRow,
  buffer,
  shakeRow,
  draftFlashRed = false,
  suppressDraft = false,
  status,
  answerLength,
  showActiveRow = true,
}: WordBoardProps) {
  const cols = Math.min(3, Math.max(1, answerLength));
  const assembled = assembleBuffer(buffer);
  const { syllables, trailing } = parseAssembled(assembled);

  const isPlaying = status === "playing";
  const activeRowIndex = currentRow;
  const hideDraft =
    suppressDraft &&
    isPlaying &&
    guesses.length > 0 &&
    guesses.length < 6;

  let activeCells: { char: string; state?: TileState; draft?: boolean }[] = Array.from(
    { length: cols },
    () => ({ char: "", draft: false }),
  );

  if (isPlaying && showActiveRow && !hideDraft) {
    activeCells = buildDraftCells(cols, syllables, trailing).map((c) => ({
      ...c,
      state: undefined as TileState | undefined,
    }));
  } else if (isPlaying && showActiveRow && hideDraft) {
    activeCells = Array.from({ length: cols }, () => ({ char: "", draft: true }));
  }

  const draftRedRow = draftFlashRed && isPlaying && showActiveRow;
  const shakeActive = shakeRow === activeRowIndex && isPlaying && showActiveRow;
  const focusIdx = activeDraftFocusIndex(cols, syllables);

  return (
    <div className="flex w-full max-w-[min(100%,22rem)] shrink-0 flex-col items-center gap-1.5 px-0.5 sm:gap-2">
      {guesses.length > 0 && (
        <div className="w-full shrink-0">
          <p className="mb-1 text-center text-[10px] font-semibold uppercase tracking-wide text-stone-500 max-[480px]:text-[9px]">
            Previous tries ({guesses.length}/6)
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
            {guesses.map((guess, ri) => {
              const ev = evaluations[ri];
              const rowCells = Array.from({ length: cols }, (_, i) => ({
                char: guess.charAt(i),
                state: ev?.[i] as TileState | undefined,
              }));
              return (
                <div
                  key={`${guess}-${ri}`}
                  className="flex shrink-0 justify-center gap-[3px] sm:gap-1"
                  aria-label={`Guess ${ri + 1}`}
                >
                  {rowCells.map((c, ci) => (
                    <div
                      key={ci}
                      className={[
                        prevCell,
                        "rounded-md border transition-colors",
                        c.state ? tileClass[c.state] : "border-stone-200 bg-white text-stone-900",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {c.char}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isPlaying && showActiveRow && (
        <div
          className={`flex justify-center gap-2 sm:gap-2.5 ${shakeActive ? "animate-shake" : ""}`}
          aria-label="Current guess"
        >
          {activeCells.map((c, ci) => {
            const isFocus = Boolean(c.draft && ci === focusIdx);
            return (
              <div
                key={ci}
                className={[
                  activeCellBase,
                  c.state ? tileClass[c.state] : "",
                  !c.state && c.char
                    ? "border-stone-800 bg-white text-stone-900 shadow-lg"
                    : "",
                  !c.state && !c.char
                    ? "border-stone-300 bg-white text-stone-400 shadow-sm"
                    : "",
                  c.draft && c.char && !c.state ? "border-stone-500" : "",
                  isFocus ? "ring-2 ring-stone-800 ring-offset-1 ring-offset-[#fafaf9]" : "",
                  draftRedRow ? "animate-draft-cell-error" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {c.char}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
