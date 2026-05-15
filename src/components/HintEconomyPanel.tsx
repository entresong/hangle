"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import type { HintRevealState, PaidHintId } from "@/lib/hintRevealStorage";

type CardState = "locked" | "revealed" | "empty";

function PaidHintCard(props: {
  title: string;
  emoji: string;
  revealed: boolean;
  hearts: number;
  onReveal: () => void;
  onShare: () => void;
  pulse?: boolean;
  children?: ReactNode;
}) {
  const state: CardState = props.revealed ? "revealed" : props.hearts <= 0 ? "empty" : "locked";
  const base =
    "w-full max-w-[min(100%,22rem)] rounded-xl border px-3 py-2.5 text-left transition-all duration-300 sm:px-3.5 sm:py-3";
  const styles =
    state === "revealed"
      ? "border-stone-300/80 bg-white shadow-md"
      : state === "empty"
        ? "border-stone-300/60 bg-stone-100/90"
        : "cursor-pointer border-stone-300/70 bg-stone-100/80 active:scale-[0.99] hover:bg-stone-100";

  const header = (
    <div className="flex items-start justify-between gap-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-stone-600 sm:text-[11px]">
        <span aria-hidden>{props.emoji}</span> {props.title}
      </p>
      {state === "locked" && (
        <span className="shrink-0 text-[10px] font-semibold text-rose-700">Tap to reveal (❤️ 1)</span>
      )}
      {state === "revealed" && (
        <span className="shrink-0 text-[10px] font-semibold text-emerald-700">✓ Revealed</span>
      )}
      {state === "empty" && (
        <span className="shrink-0 text-[10px] font-semibold text-stone-600">Out of hearts</span>
      )}
    </div>
  );

  if (state === "revealed") {
    return (
      <div className={`${base} ${styles} ${props.pulse ? "hint-card-pulse-once" : ""}`}>
        {header}
        {props.children ? (
          <div className="mt-2 text-[12px] leading-snug text-stone-800 sm:text-[13px]">{props.children}</div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (state === "locked") props.onReveal();
        if (state === "empty") props.onShare();
      }}
      className={`${base} ${styles} ${props.pulse ? "hint-card-pulse-once" : ""}`}
    >
      {header}
      {state === "empty" && (
        <div className="mt-2">
          <span className="inline-flex rounded-lg border border-rose-300/70 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-900">
            Share to refill
          </span>
        </div>
      )}
    </button>
  );
}

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
  hearts: number;
  reveal: HintRevealState;
  onReveal: (id: PaidHintId) => void;
  onShareFromCard: () => void;
  pulseHint: PaidHintId | null;
  pronunciationSlot: ReactNode;
};

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
  hearts,
  reveal,
  onReveal,
  onShareFromCard,
  pulseHint,
  pronunciationSlot,
}: HintEconomyPanelProps) {
  return (
    <section
      aria-label="Hints"
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

      <PaidHintCard
        title="Definition"
        emoji="📖"
        revealed={reveal.definition}
        hearts={hearts}
        onReveal={() => onReveal("definition")}
        onShare={onShareFromCard}
        pulse={pulseHint === "definition"}
      >
        <p>{definition}</p>
      </PaidHintCard>

      <PaidHintCard
        title="Example"
        emoji="💡"
        revealed={reveal.example}
        hearts={hearts}
        onReveal={() => onReveal("example")}
        onShare={onShareFromCard}
        pulse={pulseHint === "example"}
      >
        <p className="text-[11px] font-semibold text-stone-800">{exampleTitle}</p>
        <p className="mt-1 text-[11px] text-stone-700">{exampleBody}</p>
      </PaidHintCard>

      <PaidHintCard
        title="Pronunciation"
        emoji="🔊"
        revealed={reveal.pronunciation}
        hearts={hearts}
        onReveal={() => onReveal("pronunciation")}
        onShare={onShareFromCard}
        pulse={pulseHint === "pronunciation"}
      >
        {pronunciationSlot}
      </PaidHintCard>
    </section>
  );
}
