"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import type { HintRevealState, PaidHintId } from "@/lib/hintRevealStorage";

export type HintEconomyPanelProps = {
  categoryUpper: string;
  emoji: string;
  meaning: string;
  definition: string;
  exampleTitle: string;
  exampleBody: string;
  imageSrc?: string;
  imgBroken: boolean;
  onImgError: () => void;
  reveal: HintRevealState;
  pronunciationSlot: ReactNode;
  pulseHint: PaidHintId | null;
};

function RevealBlock({
  title,
  emoji,
  children,
  pulse,
}: {
  title: string;
  emoji: string;
  children: ReactNode;
  pulse: boolean;
}) {
  return (
    <div
      className={`hint-slide-reveal mt-2 rounded-lg border border-stone-200/90 bg-white/90 px-2 py-1.5 shadow-sm ${
        pulse ? "hint-card-pulse-once" : ""
      }`}
    >
      <p className="text-[9px] font-bold uppercase tracking-wide text-stone-500">
        <span aria-hidden>{emoji}</span> {title}
      </p>
      <div className="mt-1 text-[12px] leading-snug text-stone-800 sm:text-[13px]">{children}</div>
    </div>
  );
}

export function HintEconomyPanel({
  categoryUpper,
  emoji,
  meaning,
  definition,
  exampleTitle,
  exampleBody,
  imageSrc,
  imgBroken,
  onImgError,
  reveal,
  pronunciationSlot,
  pulseHint,
}: HintEconomyPanelProps) {
  return (
    <section
      aria-label="Word clues and hints"
      className="game-hint-card flex w-full shrink-0 flex-col gap-1.5 rounded-xl border border-stone-300/55 bg-[var(--hint-card-bg)] px-2.5 py-2 shadow-sm sm:gap-2 sm:px-3 sm:py-2.5"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="rounded-full border border-stone-400/60 bg-white/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stone-900 sm:text-[11px]">
          {emoji} {categoryUpper}
        </span>
      </div>
      {imageSrc && !imgBroken ? (
        <div className="relative mx-auto h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-white sm:h-14 sm:w-14">
          <Image src={imageSrc} alt="" fill className="object-cover" sizes="56px" onError={onImgError} />
        </div>
      ) : (
        <p className="text-center text-2xl leading-none" aria-hidden>
          {emoji}
        </p>
      )}
      <div className="shrink-0 rounded-lg border border-stone-200/90 bg-white/90 px-2 py-1.5 shadow-sm">
        <p className="text-[9px] font-bold uppercase tracking-wide text-stone-500">Meaning</p>
        <p className="text-[12px] font-semibold leading-snug text-stone-900 sm:text-[13px]">{meaning}</p>
      </div>

      {reveal.definition ? (
        <RevealBlock title="Definition" emoji="📖" pulse={pulseHint === "definition"}>
          <p>{definition}</p>
        </RevealBlock>
      ) : null}

      {reveal.example ? (
        <RevealBlock title="Example" emoji="💡" pulse={pulseHint === "example"}>
          <p className="text-[11px] font-semibold text-stone-800">{exampleTitle}</p>
          <p className="mt-1 text-[11px] text-stone-700">{exampleBody}</p>
        </RevealBlock>
      ) : null}

      {reveal.pronunciation ? (
        <RevealBlock title="Pronunciation" emoji="🔊" pulse={pulseHint === "pronunciation"}>
          {pronunciationSlot}
        </RevealBlock>
      ) : null}
    </section>
  );
}
