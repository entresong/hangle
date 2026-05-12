"use client";

import { useCallback, useEffect, useState } from "react";

type Step = "welcome" | "typing";

type Props = {
  open: boolean;
  onClose: () => void;
  onMarkVisited: () => void;
};

function JamoBox({ jamo, rom }: { jamo: string; rom: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className="flex min-h-[2.75rem] min-w-[2.75rem] items-center justify-center rounded-lg border-2 border-stone-400/70 bg-white px-2 font-serif text-[clamp(1.15rem,4.5vw,1.35rem)] font-semibold text-stone-900 shadow-sm sm:min-h-[2.85rem] sm:min-w-[2.85rem] sm:text-[1.4rem]"
        style={{ fontFamily: "var(--font-sans), 'Apple SD Gothic Neo', sans-serif" }}
      >
        {jamo}
      </span>
      <span className="text-[11px] text-stone-500 sm:text-xs">({rom})</span>
    </div>
  );
}

function Plus() {
  return (
    <span className="px-0.5 text-lg font-light text-stone-400 sm:text-xl" aria-hidden>
      +
    </span>
  );
}

function ArrowEq() {
  return (
    <span className="px-1 text-base font-medium text-amber-800/90 sm:text-lg" aria-hidden>
      =
    </span>
  );
}

function SyllableResult({ children, label }: { children: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className="flex min-h-[2.85rem] min-w-[2.85rem] items-center justify-center rounded-xl border-2 border-amber-500/80 bg-amber-50/90 px-3 font-serif text-[clamp(1.65rem,6vw,2rem)] font-bold text-stone-900 shadow-md sm:min-h-[3.25rem] sm:min-w-[3.25rem] sm:text-[2rem]"
        style={{ fontFamily: "var(--font-sans), 'Apple SD Gothic Neo', sans-serif" }}
      >
        {children}
      </span>
      <span className="text-[11px] font-medium text-amber-900/90 sm:text-xs">{label}</span>
    </div>
  );
}

export function WelcomeHelpModal({ open, onClose, onMarkVisited }: Props) {
  const [step, setStep] = useState<Step>("welcome");

  useEffect(() => {
    if (open) setStep("welcome");
  }, [open]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [open, onClose],
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/35 p-3 animate-welcome-modal-backdrop sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={step === "welcome" ? "welcome-title" : "typing-title"}
        className="max-h-[min(92dvh,640px)] w-[min(100%,90vw)] max-w-[400px] overflow-y-auto overscroll-contain rounded-2xl border border-stone-300/80 bg-[#f5f0e8] p-4 shadow-2xl animate-welcome-modal-panel sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "welcome" ? (
          <>
            <h2 id="welcome-title" className="text-center font-serif text-[clamp(1.25rem,4.5vw,1.5rem)] font-bold leading-tight text-stone-900">
              🇰🇷 Welcome to Hangle!
            </h2>
            <p className="mt-2 text-center text-[15px] leading-snug text-stone-700 sm:text-base">
              Korean Wordle for K-pop &amp; K-drama fans
            </p>

            <div className="my-4 border-t border-stone-400/35" />

            <p className="text-center text-xs font-bold uppercase tracking-[0.14em] text-stone-600">How to play</p>

            <ul className="mt-3 space-y-3 text-[14px] leading-snug text-stone-800 sm:text-[15px]">
              <li className="flex gap-2">
                <span className="shrink-0" aria-hidden>
                  🎯
                </span>
                <span>
                  Guess today&apos;s <strong>2-syllable</strong> Korean word in <strong>6 tries</strong>.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0" aria-hidden>
                  🟩
                </span>
                <span>
                  <strong>Green</strong> — correct letter <em>and</em> position.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0" aria-hidden>
                  🟨
                </span>
                <span>
                  <strong>Yellow</strong> — letter is in the word, <em>wrong</em> position.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0" aria-hidden>
                  ⬜
                </span>
                <span>
                  <strong>Gray</strong> — not in the word.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0" aria-hidden>
                  💡
                </span>
                <span>Hints unlock as you guess (depends on difficulty).</span>
              </li>
            </ul>

            <div className="my-4 border-t border-stone-400/35" />

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => setStep("typing")}
                className="w-full min-h-[48px] rounded-xl border border-stone-400/80 bg-white px-4 py-3 text-[15px] font-semibold text-stone-900 shadow-sm transition hover:bg-stone-50 active:scale-[0.99]"
              >
                📖 Learn Korean typing
              </button>
              <button
                type="button"
                onClick={() => {
                  onMarkVisited();
                }}
                className="w-full min-h-[48px] rounded-xl bg-stone-800 px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition hover:bg-stone-700 active:scale-[0.99]"
              >
                Got it! Let&apos;s play →
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="typing-title" className="text-center font-serif text-[clamp(1.15rem,4vw,1.35rem)] font-bold leading-tight text-stone-900">
              How Korean typing works
            </h2>
            <p className="mt-2 text-center text-[14px] leading-snug text-stone-700 sm:text-[15px]">
              Korean letters <strong>combine</strong> into syllable blocks. Tap consonants and vowels on the on-screen
              keyboard to build each block.
            </p>

            <div className="my-4 border-t border-stone-400/35" />

            <p className="text-center text-xs font-bold uppercase tracking-wide text-stone-600">Example 1 · 봄 (spring)</p>
            <div className="mt-3 flex flex-wrap items-end justify-center gap-y-2">
              <JamoBox jamo="ㅂ" rom="b" />
              <Plus />
              <JamoBox jamo="ㅗ" rom="o" />
              <Plus />
              <JamoBox jamo="ㅁ" rom="m" />
              <ArrowEq />
              <SyllableResult label="one syllable">봄</SyllableResult>
            </div>
            <p className="mt-2 text-center text-[13px] text-stone-600 sm:text-sm">
              Tap <strong>ㅂ · ㅗ · ㅁ</strong> in order on the keyboard — they merge into <strong>봄</strong>.
            </p>

            <div className="my-4 border-t border-stone-400/35" />

            <p className="text-center text-xs font-bold uppercase tracking-wide text-stone-600">Example 2 · 사랑 (love)</p>
            <p className="mt-2 text-center text-[13px] text-stone-600 sm:text-sm">Two syllables = two blocks.</p>

            <div className="mt-3 flex flex-col items-center gap-4">
              <div>
                <p className="mb-2 text-center text-[11px] font-semibold uppercase text-stone-500">First syllable · 사</p>
                <div className="flex flex-wrap items-end justify-center gap-y-2">
                  <JamoBox jamo="ㅅ" rom="s" />
                  <Plus />
                  <JamoBox jamo="ㅏ" rom="a" />
                  <ArrowEq />
                  <SyllableResult label="사">사</SyllableResult>
                </div>
              </div>
              <div>
                <p className="mb-2 text-center text-[11px] font-semibold uppercase text-stone-500">Second syllable · 랑</p>
                <div className="flex flex-wrap items-end justify-center gap-y-2">
                  <JamoBox jamo="ㄹ" rom="r / l" />
                  <Plus />
                  <JamoBox jamo="ㅏ" rom="a" />
                  <Plus />
                  <JamoBox jamo="ㅇ" rom="ng" />
                  <ArrowEq />
                  <SyllableResult label="랑">랑</SyllableResult>
                </div>
              </div>
            </div>

            <div className="my-4 border-t border-stone-400/35" />

            <p className="text-center text-xs font-bold uppercase tracking-wide text-stone-600">Tips</p>
            <ul className="mt-2 space-y-2 text-[13px] leading-snug text-stone-800 sm:text-[14px]">
              <li className="flex gap-2">
                <span className="text-stone-500">•</span>
                <span>Each large square on the answer grid = <strong>one syllable</strong> (one block).</span>
              </li>
              <li className="flex gap-2">
                <span className="text-stone-500">•</span>
                <span>
                  Usually <strong>consonant + vowel</strong> (and sometimes a final consonant under the vowel).
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-stone-500">•</span>
                <span>
                  Use <strong>Shift</strong> on the keyboard for <strong>tense</strong> consonants (e.g. ㅂ → ㅃ) where
                  shown.
                </span>
              </li>
            </ul>

            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => setStep("welcome")}
                className="order-2 w-full min-h-[48px] rounded-xl border border-stone-400/80 bg-white px-4 py-3 text-[15px] font-semibold text-stone-800 shadow-sm transition hover:bg-stone-50 sm:order-1 sm:w-auto sm:min-w-[7rem]"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => onMarkVisited()}
                className="order-1 w-full min-h-[48px] rounded-xl bg-stone-800 px-4 py-3 text-[15px] font-semibold text-white shadow-sm transition hover:bg-stone-700 sm:order-2 sm:ml-auto sm:w-auto sm:min-w-[10rem]"
              >
                Got it! Play →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
