"use client";

import { useMemo, useState } from "react";
import Hangul from "hangul-js";
import {
  assembleBuffer,
  backspaceJamo,
  canAcceptJamo,
  parseAssembled,
} from "@/lib/hangulBuffer";

/** 표준 두벌식 3줄 — grid로 한 줄 고정 (모바일 줄바꿈 방지) */
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

function jamoSetFromFirstJamo(jamo: string): Set<string> {
  const set = new Set<string>();
  const t = jamo.trim();
  if (!t) return set;
  const parts = Hangul.disassemble(t, false);
  for (const j of parts) {
    if (typeof j === "string" && j.length === 1) set.add(j);
  }
  return set;
}

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
  const label = shiftActive && shifted !== undefined ? shifted : baseKey;
  if (highlightJamos.has(label)) return true;
  if (!shiftActive && shifted !== undefined && highlightJamos.has(shifted)) return true;
  return false;
}

type HangulKeyboardProps = {
  buffer: string[];
  onBufferChange: (next: string[]) => void;
  onEnter: () => void;
  disabled?: boolean;
  enterPaused?: boolean;
  targetSyllables: number;
  highlightAnswer?: string;
  highlightFirstJamo?: string;
};

const JAMO_ROWS: readonly { keys: readonly string[]; id: string }[] = [
  { keys: ROW1, id: "r1" },
  { keys: ROW2, id: "r2" },
  { keys: ROW3, id: "r3" },
];

export function HangulKeyboard({
  buffer,
  onBufferChange,
  onEnter,
  disabled,
  enterPaused = false,
  targetSyllables,
  highlightAnswer = "",
  highlightFirstJamo = "",
}: HangulKeyboardProps) {
  const [shiftActive, setShiftActive] = useState(false);
  const [pressedKey, setPressedKey] = useState<string | null>(null);

  const highlightJamos = useMemo(() => {
    const first = highlightFirstJamo.trim();
    if (first) return jamoSetFromFirstJamo(first);
    return jamoSetFromAnswer(highlightAnswer);
  }, [highlightAnswer, highlightFirstJamo]);

  const flashPress = (id: string) => {
    setPressedKey(id);
    window.setTimeout(() => setPressedKey(null), 140);
  };

  const emitJamo = (baseKey: string, rowId: string, index: number) => {
    if (disabled) return;
    const shifted = SHIFT_MAP[baseKey];
    const jamo = shiftActive && shifted !== undefined ? shifted : baseKey;
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

  const highlightRing =
    "border-amber-500/95 bg-amber-50 text-stone-900 ring-2 ring-amber-400/70";

  const pressFlash = "ring-2 ring-amber-500/90 bg-amber-100";

  const enterDisabled =
    disabled ||
    enterPaused ||
    syllables.length < targetSyllables ||
    trailing.length > 0 ||
    syllables.length > targetSyllables;

  const shiftBtnClass = `${baseBtn} h-10 min-h-[40px] shrink-0 rounded-md px-2 text-[11px] font-semibold sm:h-11 sm:min-h-[44px] sm:px-3 sm:text-xs ${
    shiftActive
      ? "border-amber-600 bg-amber-200 text-amber-950 ring-2 ring-amber-500 shadow-inner"
      : "border-stone-400 bg-stone-100 text-stone-700"
  } ${pressedKey === "shift" ? pressFlash : ""}`;

  return (
    <div className="mx-auto w-full max-w-[500px] shrink-0 select-none px-0 font-sans">
      <p className="mb-0.5 truncate px-1 text-center text-[11px] leading-tight text-stone-600 max-[480px]:mb-0 sm:mb-1 sm:min-h-[1rem] sm:text-[12px]">
        {preview ? (
          <span className="font-semibold tracking-wide text-stone-900">{preview}</span>
        ) : (
          <span className="text-stone-400 max-[480px]:text-[10px]">Shift · double jamo</span>
        )}
      </p>

      <div className="flex flex-col gap-[3px] sm:gap-1.5 md:gap-2">
        {JAMO_ROWS.map(({ keys, id }) => (
          <div
            key={id}
            className="mx-auto grid w-full max-w-[min(100%,26rem)] gap-[3px] px-0.5 sm:max-w-[26rem] sm:gap-1 md:gap-1.5"
            style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}
          >
            {keys.map((baseKey, index) => {
              const shifted = SHIFT_MAP[baseKey];
              const label = shiftActive && shifted !== undefined ? shifted : baseKey;
              const hi = keyHighlighted(baseKey, shiftActive, highlightJamos);
              const pressed = pressedKey === `${id}-${index}`;
              return (
                <button
                  key={`${id}-${baseKey}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => emitJamo(baseKey, id, index)}
                  className={`${baseBtn} h-10 min-h-[40px] w-full min-w-0 text-[clamp(12px,3.5vw,16px)] leading-none sm:h-11 sm:min-h-[44px] sm:text-[0.95rem] md:text-base ${hi ? highlightRing : ""} ${pressed ? pressFlash : ""}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ))}

        <div className="mx-auto flex w-full max-w-[min(100%,26rem)] items-stretch gap-[3px] px-0.5 pt-0.5 sm:gap-2">
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
            className={`${baseBtn} h-10 min-h-[40px] shrink-0 rounded-md px-2 text-[11px] font-semibold sm:h-11 sm:min-h-[44px] sm:px-3 sm:text-xs ${
              pressedKey === "del" ? pressFlash : ""
            }`}
          >
            Delete
          </button>
          <button
            type="button"
            disabled={enterDisabled}
            onClick={() => {
              if (enterDisabled) return;
              flashPress("ent");
              onEnter();
            }}
            className={`h-10 min-h-[40px] min-w-0 flex-1 rounded-md border border-stone-700 bg-stone-800 px-2 text-[12px] font-semibold text-white shadow-sm transition hover:bg-stone-700 active:scale-[0.97] disabled:bg-stone-400 disabled:opacity-40 sm:h-11 sm:min-h-[44px] sm:text-sm ${pressedKey === "ent" ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
          >
            Enter
          </button>
        </div>
      </div>
    </div>
  );
}
