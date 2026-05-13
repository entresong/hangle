"use client";

import Link from "next/link";
import type { PhraseEntry } from "@/types/phrase";

type Props = {
  phrase: PhraseEntry;
  exampleKorean: string;
  speechUnavailable: boolean;
  ttsPlayingPhrase: boolean;
  ttsPlayingExample: boolean;
  onSpeakPhrase: () => void;
  onSpeakExample: () => void;
};

export function TodayPhraseBonus({
  phrase,
  exampleKorean,
  speechUnavailable,
  ttsPlayingPhrase,
  ttsPlayingExample,
  onSpeakPhrase,
  onSpeakExample,
}: Props) {
  return (
    <section
      aria-label="Bonus learning phrase"
      className="today-phrase-bonus mt-5 max-h-[min(52vh,28rem)] overflow-y-auto overscroll-contain rounded-2xl border-2 border-amber-200/90 bg-[#f5f0e8] p-3 shadow-inner sm:p-4"
    >
      <div className="flex items-center justify-between gap-2 border-b border-amber-300/40 pb-2">
        <p className="cursor-default text-[10px] font-bold uppercase tracking-[0.12em] text-amber-900/90 sm:text-[11px]">
          💬 Bonus phrase
        </p>
        <span className="shrink-0 cursor-default select-none rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-semibold uppercase text-stone-600 ring-1 ring-stone-300/60">
          {phrase.category}
        </span>
      </div>

      <div className="mt-3 flex flex-col items-center text-center">
        <span
          className="select-none text-[2.75rem] leading-none sm:text-[3.25rem]"
          style={{
            fontFamily: "system-ui, 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif",
          }}
          aria-hidden
        >
          {phrase.emoji}
        </span>
        <p className="mt-2 font-serif text-[clamp(1.35rem,5.5vw,1.75rem)] font-semibold leading-tight text-stone-900">
          {phrase.phrase}
        </p>

        <div className="mt-2 flex w-full flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onSpeakPhrase}
            disabled={speechUnavailable}
            aria-label="Listen to pronunciation of the phrase"
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-stone-400/80 bg-white px-3 py-2 text-sm font-semibold text-stone-900 shadow-sm transition hover:bg-stone-50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${ttsPlayingPhrase ? "border-amber-500/70 bg-amber-50 ring-2 ring-amber-400/60" : ""}`}
          >
            <span className="text-lg leading-none" aria-hidden>
              🔊
            </span>
            <span className="text-xs sm:text-sm">Listen</span>
          </button>
          {exampleKorean ? (
            <button
              type="button"
              onClick={onSpeakExample}
              disabled={speechUnavailable}
              aria-label="Listen to Korean in the example"
              className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-xl border border-stone-400/80 bg-white px-3 py-2 text-sm font-semibold text-stone-900 shadow-sm transition hover:bg-stone-50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${ttsPlayingExample ? "border-amber-500/70 bg-amber-50 ring-2 ring-amber-400/60" : ""}`}
            >
              <span className="text-lg leading-none" aria-hidden>
                🔊
              </span>
              <span className="text-xs sm:text-sm">Example</span>
            </button>
          ) : null}
        </div>
      </div>

      <p className="mt-3 text-center text-sm font-medium text-stone-800">&ldquo;{phrase.meaning}&rdquo;</p>
      <p className="mt-1 text-center text-xs leading-snug text-stone-600">{phrase.definition}</p>

      <div className="mt-3 rounded-xl border border-stone-300/50 bg-white/50 px-3 py-2.5 text-left">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">📝 Example</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-stone-900">{phrase.example}</p>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-stone-600">
        <span className="font-semibold text-stone-700">💡 Used: </span>
        {phrase.usage}
      </p>

      <div className="mt-3 border-t border-amber-200/60 pt-3 text-center">
        <Link
          href="/phrases"
          className="inline-flex min-h-[44px] items-center justify-center text-sm font-semibold text-amber-900 underline decoration-amber-600/70 underline-offset-2 hover:text-amber-950"
        >
          More Phrases →
        </Link>
      </div>
    </section>
  );
}
