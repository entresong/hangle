"use client";

import type { ReactNode } from "react";

/**
 * Single source of truth for floating toasts in the app.
 *
 * Positioning rules (mobile-first):
 *  - Fixed, bottom-anchored so it never overlaps the header.
 *  - Sits ABOVE the on-screen Hangul keyboard via a `bottom` value that
 *    accounts for the keyboard footprint (~14rem) plus iOS safe-area.
 *  - Centered horizontally with `left:50% / translateX(-50%)`.
 *  - Opaque background + soft shadow — no transparency tricks that bleed
 *    into header text behind it.
 *
 * Variants:
 *  - `neutral` — small status (mode change, dead-click guidance light)
 *  - `info`    — amber accent for important callouts (welcome, hint unlocks)
 *  - `welcome` — bigger, bolder, longer-lived greeting
 */
export type AppToastVariant = "neutral" | "info" | "welcome";

type Props = {
  children: ReactNode;
  variant?: AppToastVariant;
  /** Stacking order when multiple toasts may briefly overlap. Higher = on top. */
  z?: number;
  /** Stable identity → animation re-fires when content changes */
  toastKey?: string;
  /** When true, play fade-out animation in place of the slide-in (caller still unmounts after) */
  exiting?: boolean;
  /** When set, shows a dismiss control and enables pointer events on the toast shell */
  onDismiss?: () => void;
};

const VARIANT_STYLES: Record<AppToastVariant, string> = {
  neutral:
    "border border-stone-400/85 bg-[#faf7f0] text-stone-900 text-[12px] sm:text-[13px] px-4 py-2",
  info:
    "border border-amber-400/85 bg-amber-50 text-amber-950 text-[12px] sm:text-[13px] px-4 py-2",
  welcome:
    "border-2 border-amber-500/85 bg-[#fef9ec] text-stone-900 text-[13px] sm:text-[15px] px-5 py-2.5 font-bold",
};

export function AppToast({
  children,
  variant = "neutral",
  z = 70,
  toastKey,
  exiting = false,
  onDismiss,
}: Props) {
  const anim = exiting ? "app-toast-fade-out" : "app-toast-slide-in";
  const shell = `max-w-[min(90vw,22rem)] rounded-xl font-semibold leading-snug shadow-lg ${VARIANT_STYLES[variant]}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`${onDismiss ? "pointer-events-auto" : "pointer-events-none"} fixed left-1/2 px-3`}
      style={{
        bottom: "max(15rem, calc(env(safe-area-inset-bottom, 0px) + 14rem))",
        transform: "translateX(-50%)",
        zIndex: z,
      }}
    >
      {onDismiss ? (
        <div key={toastKey} className={`${anim} flex items-start gap-1.5 ${shell} pl-3 pr-1 py-2`}>
          <p className="min-w-0 flex-1 text-center text-[12px] leading-snug sm:text-[13px]">{children}</p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notification"
            className="flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-md text-lg leading-none text-amber-900/80 transition hover:bg-amber-200/60 hover:text-amber-950"
          >
            ×
          </button>
        </div>
      ) : (
        <p key={toastKey} className={`${anim} max-w-[min(90vw,22rem)] rounded-xl text-center font-semibold leading-snug shadow-lg ${VARIANT_STYLES[variant]}`}>
          {children}
        </p>
      )}
    </div>
  );
}
