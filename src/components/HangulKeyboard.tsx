"use client";

import { useMemo, useState } from "react";
import Hangul from "hangul-js";
import {
  assembleBuffer,
  backspaceJamo,
  canAcceptJamo,
  parseAssembled,
} from "@/lib/hangulBuffer";

/** 표준 두벌식 3줄 */
const ROW1 = ["ㅂ", "ㅈ", "ㄷ", "ㄱ", "ㅅ", "ㅛ", "ㅕ", "ㅑ", "ㅐ", "ㅔ"];
const ROW2 = ["ㅁ", "ㄴ", "ㅇ", "ㄹ", "ㅎ", "ㅗ", "ㅓ", "ㅏ", "ㅣ"];
const ROW3 = ["ㅋ", "ㅌ", "ㅊ", "ㅍ", "ㅠ", "ㅜ", "ㅡ"];

/** Shift + 자음/모음 → 쌍자음·이중모음 일부 (실물 키보드와 동일 규칙) */
const SHIFT_MAP: Record<string, string> = {
  "ㅂ": "ㅃ",
  "ㅈ": "ㅉ",
  "ㄷ": "ㄸ",
  "ㄱ": "ㄲ",
  "ㅅ": "ㅆ",
  "ㅐ": "ㅒ",
  "ㅔ": "ㅖ",
};

function jamoSetFromAnswer(answer: string): Set<string> {
  const set = new Set<string>();
  if (!answer) return set;
  const parts = Hangul.disassemble(answer, false);
  for (const j of parts) {
    if (typeof j === "string" && j.length === 1) set.add(j);
  }
  return set;
}

function keyHighlighted(
  baseKey: string,
  shiftActive: boolean,
  highlightJamos: Set<string>,
): boolean {
  const shifted = SHIFT_MAP[baseKey];
  const label =
    shiftActive && shifted !== undefined ? shifted : baseKey;
  if (highlightJamos.has(label)) return true;
  if (!shiftActive && shifted !== undefined && highlightJamos.has(shifted)) return true;
  return false;
}

type HangulKeyboardProps = {
  buffer: string[];
  onBufferChange: (next: string[]) => void;
  onEnter: () => void;
  disabled?: boolean;
  /** Blocks Enter briefly after a successful row submit (next row reveal delay). */
  enterPaused?: boolean;
  /** Smaller keys / gaps for short viewports */
  compact?: boolean;
  targetSyllables: number;
  highlightAnswer?: string;
};

export function HangulKeyboard({
  buffer,
  onBufferChange,
  onEnter,
  disabled,
  enterPaused = false,
  compact = false,
  targetSyllables,
  highlightAnswer = "",
}: HangulKeyboardProps) {
  const [shiftActive, setShiftActive] = useState(false);
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  const highlightJamos = useMemo(
    () => jamoSetFromAnswer(highlightAnswer),
    [highlightAnswer],
  );

  const flashPress = (id: string) => {
    setPressedKey(id);
    window.setTimeout(() => setPressedKey(null), 140);
  };

  const emitJamo = (baseKey: string, rowId: string, index: number) => {
    if (disabled) return;
    const shifted = SHIFT_MAP[baseKey];
    const jamo =
      shiftActive && shifted !== undefined ? shifted : baseKey;
    if (!canAcceptJamo(buffer, jamo, targetSyllables)) return;
    flashPress(`${rowId}-${index}`);
    onBufferChange([...buffer, jamo]);
  };

  const onBack = () => {
    if (disabled) return;
    flashPress("del");
    onBufferChange(backspaceJamo(buffer));
  };

  const toggleShift = () => {
    if (disabled) return;
    flashPress("shift");
    setShiftActive((v) => !v);
  };

  const assembled = assembleBuffer(buffer);
  const { syllables, trailing } = parseAssembled(assembled);
  const preview = assembled;

  const baseBtn =
    "rounded-md border border-stone-300/90 bg-white font-medium text-stone-900 shadow-sm transition hover:bg-stone-50 disabled:pointer-events-none disabled:opacity-40 active:scale-[0.96]";

  const jamoBtn = compact
    ? "min-h-[clamp(1.05rem,5vmin,1.55rem)] min-w-[clamp(1.22rem,5.8vmin,1.72rem)] px-0.5 text-[clamp(0.52rem,2.35vmin,0.68rem)] max-[667px]:min-h-[1rem] max-[667px]:min-w-[1.15rem] max-[667px]:text-[0.5rem] sm:min-w-[1.85rem] sm:text-[0.68rem]"
    : "min-h-[clamp(1.42rem,6.8vmin,1.95rem)] min-w-[clamp(1.48rem,7.2vmin,2.05rem)] px-0.5 text-[clamp(0.62rem,2.75vmin,0.78rem)] sm:min-w-[2rem] sm:text-[0.74rem]";

  const highlightRing =
    "border-amber-500/95 bg-amber-50 text-stone-900 ring-2 ring-amber-400/70";

  const pressFlash = "ring-2 ring-amber-500/90 bg-amber-100";

  const enterDisabled =
    disabled ||
    enterPaused ||
    syllables.length < targetSyllables ||
    trailing.length > 0 ||
    syllables.length > targetSyllables;

  const shiftBtnClass = `${baseBtn} ${compact ? "min-h-[clamp(1.05rem,5vmin,1.55rem)] min-w-[2.6rem] px-1.5 text-[clamp(0.48rem,2.1vmin,0.62rem)] sm:min-w-[3rem]" : "min-h-[clamp(1.38rem,6.5vmin,1.88rem)] min-w-[3rem] px-2 text-[clamp(0.55rem,2.35vmin,0.68rem)] sm:min-w-[3.25rem] sm:text-[0.7rem]"} shrink-0 font-semibold ${
    shiftActive
      ? "border-amber-600 bg-amber-200 text-amber-950 ring-2 ring-amber-500 shadow-inner"
      : "border-stone-400 bg-stone-100 text-stone-700"
  } ${pressedKey === "shift" ? pressFlash : ""}`;

  const renderRow = (keys: readonly string[], rowId: string) => (
    <div
      className={`flex w-full flex-wrap justify-center ${compact ? "gap-x-1 gap-y-1 max-[667px]:gap-x-[3px] max-[667px]:gap-y-[3px] sm:gap-x-1.5 sm:gap-y-1.5" : "gap-x-[5px] gap-y-[5px] sm:gap-x-1.5"}`}
    >
      {keys.map((baseKey, index) => {
        const shifted = SHIFT_MAP[baseKey];
        const label =
          shiftActive && shifted !== undefined ? shifted : baseKey;
        const hi = keyHighlighted(baseKey, shiftActive, highlightJamos);
        const id = `${rowId}-${index}`;
        const pressed = pressedKey === id;

        return (
          <button
            key={`${rowId}-${baseKey}`}
            type="button"
            disabled={disabled}
            onClick={() => emitJamo(baseKey, rowId, index)}
            className={`${baseBtn} ${jamoBtn} ${hi ? highlightRing : ""} ${pressed ? pressFlash : ""}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[500px] select-none px-0 font-sans">
      <p
        className={`truncate text-center tabular-nums leading-snug text-stone-500 ${compact ? "mb-0.5 min-h-[0.875rem] text-[9px] sm:text-[10px]" : "mb-1 min-h-[1rem] text-[10px] sm:text-[11px]"}`}
      >
        {preview ? (
          <span className="font-semibold tracking-wide text-stone-900">{preview}</span>
        ) : (
          <span className="text-stone-400">Compose Hangul · Shift for double consonants</span>
        )}
      </p>

      <div className={`flex flex-col ${compact ? "gap-1 max-[667px]:gap-[5px] sm:gap-1.5" : "gap-[6px] sm:gap-2"}`}>
        {renderRow(ROW1, "r1")}
        {renderRow(ROW2, "r2")}
        {renderRow(ROW3, "r3")}

        <div
          className={`flex items-stretch pt-0.5 ${compact ? "gap-1 max-[667px]:gap-0.5 sm:gap-1.5" : "gap-2"}`}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={toggleShift}
            className={shiftBtnClass}
            aria-pressed={shiftActive}
          >
            Shift
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onBack}
            className={`${baseBtn} ${compact ? "min-h-[clamp(1.05rem,5vmin,1.55rem)] min-w-[3.75rem] px-2 text-[clamp(0.52rem,2.2vmin,0.66rem)]" : "min-h-[clamp(1.38rem,6.5vmin,1.88rem)] min-w-[4.5rem] px-3 text-[clamp(0.58rem,2.4vmin,0.72rem)]"} shrink-0 ${
              pressedKey === "del" ? pressFlash : ""
            }`}
          >
            Delete
          </button>
          <div className="min-w-0 flex-1" aria-hidden />
          <button
            type="button"
            disabled={enterDisabled}
            onClick={() => {
              if (enterDisabled) return;
              flashPress("ent");
              onEnter();
            }}
            className={`${compact ? "min-h-[clamp(1.05rem,5vmin,1.55rem)] min-w-[4rem] px-3 text-[clamp(0.52rem,2.2vmin,0.66rem)]" : "min-h-[clamp(1.38rem,6.5vmin,1.88rem)] min-w-[4.75rem] px-4 text-[clamp(0.58rem,2.4vmin,0.72rem)]"} shrink-0 rounded-md border border-stone-700 bg-stone-800 font-semibold text-white shadow-sm transition hover:bg-stone-700 active:scale-[0.97] disabled:bg-stone-400 disabled:opacity-40 ${pressedKey === "ent" ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
          >
            Enter
          </button>
        </div>
      </div>
    </div>
  );
}
