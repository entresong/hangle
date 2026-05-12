"use client";

import type { TileState } from "@/types/game";
import { assembleBuffer, parseAssembled } from "@/lib/hangulBuffer";

const tileClass: Record<TileState, string> = {
  correct: "bg-emerald-500 border-emerald-600 text-white",
  present: "bg-amber-400 border-amber-500 text-white",
  absent: "bg-stone-400 border-stone-500 text-white",
};

type GridProps = {
  guesses: string[];
  evaluations: TileState[][];
  currentRow: number;
  /** Jamo buffer for the active row */
  buffer: string[];
  shakeRow: number | null;
  /** Invalid syllable count etc.: draft tiles flash red */
  draftFlashRed?: boolean;
  /**
   * Briefly hide the next-row draft after a submit so colors on the locked row read first.
   * Buffer still updates; cells show empty until cleared.
   */
  suppressDraft?: boolean;
  status: "playing" | "won" | "lost";
  /** 정답 음절 수 (1–3) */
  answerLength: number;
  /** Smaller cells when hint panel needs more vertical room */
  dense?: boolean;
  /** Extra-tight tiles on narrow / short phones */
  compact?: boolean;
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

export function Grid({
  guesses,
  evaluations,
  currentRow,
  buffer,
  shakeRow,
  draftFlashRed = false,
  suppressDraft = false,
  status,
  answerLength,
  dense = false,
  compact = false,
}: GridProps) {
  const rows = 6;
  const cols = Math.min(3, Math.max(1, answerLength));
  const assembled = assembleBuffer(buffer);
  const { syllables, trailing } = parseAssembled(assembled);

  const tight = dense || compact;

  const cellSize =
    cols >= 3
      ? tight
        ? compact
          ? "h-[31px] w-[31px] text-[0.92rem] max-[667px]:h-[29px] max-[667px]:w-[29px] max-[667px]:text-[0.88rem] sm:h-[42px] sm:w-[42px] sm:text-[1.18rem]"
          : "h-[38px] w-[38px] text-[1.08rem] sm:h-[48px] sm:w-[48px] sm:text-[1.38rem]"
        : "h-[44px] w-[44px] text-[1.22rem] sm:h-[54px] sm:w-[54px] sm:text-[1.48rem]"
      : tight
        ? compact
          ? "h-[34px] w-[34px] text-[1.05rem] max-[667px]:h-[32px] max-[667px]:w-[32px] max-[667px]:text-[1rem] sm:h-[46px] sm:w-[46px] sm:text-[1.38rem]"
          : "h-[42px] w-[42px] text-[1.28rem] sm:h-[52px] sm:w-[52px] sm:text-[1.52rem]"
        : "h-[48px] w-[48px] text-[1.42rem] sm:h-[58px] sm:w-[58px] sm:text-[1.72rem]";

  const rowGap =
    compact ? "gap-y-[5px] max-[667px]:gap-y-1 sm:gap-y-2" : "gap-y-1.5 sm:gap-y-2";
  const colGap =
    compact ? "gap-1 max-[667px]:gap-[3px] sm:gap-2" : "gap-1.5 sm:gap-2";

  return (
    <div className={`flex w-full shrink-0 flex-col items-center ${rowGap}`}>
      {Array.from({ length: rows }, (_, ri) => {
        const guess = guesses[ri] ?? "";
        const ev = evaluations[ri];
        const isCurrent = status === "playing" && ri === currentRow;
        const shake = shakeRow === ri;
        const hideDraft =
          suppressDraft &&
          isCurrent &&
          guesses.length > 0 &&
          guesses.length < 6;

        let cells: { char: string; state?: TileState; draft?: boolean }[] = Array.from(
          { length: cols },
          () => ({ char: "", draft: false }),
        );

        if (guess.length === cols) {
          cells = Array.from({ length: cols }, (_, i) => ({
            char: guess.charAt(i),
            state: ev?.[i],
            draft: false,
          }));
        } else if (isCurrent && !hideDraft) {
          cells = buildDraftCells(cols, syllables, trailing).map((c) => ({
            ...c,
            state: undefined as TileState | undefined,
          }));
        }

        const draftRedRow =
          draftFlashRed && isCurrent && status === "playing";

        return (
          <div
            key={ri}
            className={`flex justify-center ${colGap} ${shake ? "animate-shake" : ""}`}
          >
            {cells.map((c, ci) => (
              <div
                key={ci}
                className={[
                  "flex shrink-0 items-center justify-center rounded-md border-2 font-medium transition-colors",
                  cellSize,
                  c.state ? tileClass[c.state] : "",
                  !c.state && c.char
                    ? "border-stone-800 bg-white text-stone-900"
                    : "",
                  !c.state && !c.char
                    ? "border-stone-200 bg-white text-stone-400"
                    : "",
                  c.draft && c.char ? "border-stone-400" : "",
                  draftRedRow ? "animate-draft-cell-error" : "",
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
  );
}
