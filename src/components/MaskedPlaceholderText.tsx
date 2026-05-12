"use client";

import { Fragment } from "react";

const PLACEHOLDER = "____";

/**
 * Renders text where `____` is shown as a subtle blank (answer hidden during play).
 */
export function MaskedPlaceholderText({ text }: { text: string }) {
  if (!text.includes(PLACEHOLDER)) {
    return <>{text}</>;
  }
  const parts = text.split(PLACEHOLDER);
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={`m-${i}-${part.length}`}>
          {part}
          {i < parts.length - 1 ? (
            <span
              className="mx-0.5 inline-block rounded-sm bg-stone-300/55 px-1 font-mono text-sm font-semibold tabular-nums text-stone-700 ring-1 ring-stone-400/35"
              aria-label="Hidden word"
            >
              {PLACEHOLDER}
            </span>
          ) : null}
        </Fragment>
      ))}
    </>
  );
}
