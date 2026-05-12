"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import phrasesJson from "@/data/phrases.json";
import { hangulChunksFromText, isSpeechSynthesisSupported, playPronunciation } from "@/lib/pronunciation";
import type { PhraseEntry } from "@/types/phrase";

const PHRASES = phrasesJson as PhraseEntry[];

type Playing = "phrase" | "example" | null;

export default function PhrasesPage() {
  const [openId, setOpenId] = useState<number | null>(null);
  const [playing, setPlaying] = useState<Playing>(null);
  const [speechOk, setSpeechOk] = useState(false);
  useEffect(() => {
    setSpeechOk(isSpeechSynthesisSupported());
  }, []);

  const speak = useCallback(
    (mode: Playing, text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !speechOk) return;
      playPronunciation(trimmed, {
        onStart: () => setPlaying(mode),
        onEnd: () => setPlaying((p) => (p === mode ? null : p)),
        onError: () => setPlaying((p) => (p === mode ? null : p)),
      });
    },
    [speechOk],
  );

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-lg flex-col bg-[#fafaf9] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] font-sans text-stone-800">
      <header className="mb-4 flex shrink-0 items-center gap-3">
        <Link
          href="/"
          className="min-h-11 min-w-11 shrink-0 rounded-lg border border-stone-300 bg-white px-2 py-2 text-center text-sm font-medium text-stone-800 shadow-sm hover:bg-stone-50"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-xl font-semibold text-stone-900 sm:text-2xl">Korean phrases</h1>
          <p className="text-xs text-stone-500">Standard expressions · tap a card for details</p>
        </div>
      </header>

      {!speechOk && (
        <p className="mb-3 rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-[11px] text-amber-950">
          For pronunciation, try Chrome — Korean (ko-KR) voices work best.
        </p>
      )}

      <ul className="flex flex-col gap-2 pb-6">
        {PHRASES.map((p) => {
          const open = openId === p.id;
          const exKo = hangulChunksFromText(p.example);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : p.id)}
                className="w-full rounded-2xl border border-stone-300/80 bg-[#f5f0e8] p-3 text-left shadow-sm transition hover:border-amber-300/70 hover:bg-[#efe8dc] sm:p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl leading-none" aria-hidden>
                    {p.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-serif text-lg font-semibold text-stone-900">{p.phrase}</p>
                    <p className="text-sm text-stone-600">{p.meaning}</p>
                  </div>
                  <span className="shrink-0 text-stone-400">{open ? "▲" : "▼"}</span>
                </div>
                {open && (
                  <div className="mt-3 border-t border-stone-300/40 pt-3">
                    <p className="text-xs leading-snug text-stone-600">{p.definition}</p>
                    <p className="mt-2 text-[10px] font-semibold uppercase text-stone-500">{p.category}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!speechOk}
                        onClick={(e) => {
                          e.stopPropagation();
                          speak("phrase", p.phrase);
                        }}
                        className={`rounded-lg border border-stone-400/80 bg-white px-3 py-2 text-xs font-semibold shadow-sm hover:bg-stone-50 disabled:opacity-50 ${playing === "phrase" ? "ring-2 ring-amber-400" : ""}`}
                      >
                        🔊 Phrase
                      </button>
                      {exKo ? (
                        <button
                          type="button"
                          disabled={!speechOk}
                          onClick={(e) => {
                            e.stopPropagation();
                            speak("example", exKo);
                          }}
                          className={`rounded-lg border border-stone-400/80 bg-white px-3 py-2 text-xs font-semibold shadow-sm hover:bg-stone-50 disabled:opacity-50 ${playing === "example" ? "ring-2 ring-amber-400" : ""}`}
                        >
                          🔊 Example
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs font-medium text-stone-700">Example</p>
                    <p className="text-sm leading-relaxed text-stone-900">{p.example}</p>
                    <p className="mt-2 text-xs text-stone-600">
                      <span className="font-semibold">When: </span>
                      {p.usage}
                    </p>
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
