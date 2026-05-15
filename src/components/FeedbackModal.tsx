"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const FEEDBACK_TYPES = [
  { value: "bug", label: "🐛 Bug report" },
  { value: "suggestion", label: "💡 Suggestion" },
  { value: "word_request", label: "🎮 Word request" },
  { value: "hi", label: "❤️ Just saying hi" },
  { value: "other", label: "🤔 Other" },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function deviceType(): "mobile" | "tablet" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  const ua = navigator.userAgent;
  const narrow = window.matchMedia?.("(max-width: 640px)")?.matches ?? window.innerWidth <= 640;
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) {
    if (/iPad|Tablet/i.test(ua) || (window.innerWidth >= 768 && window.innerWidth <= 1024))
      return "tablet";
    return "mobile";
  }
  if (narrow) return "mobile";
  return "desktop";
}

export type FeedbackModalProps = {
  open: boolean;
  onClose: () => void;
  gamesPlayed: number;
};

export function FeedbackModal({
  open,
  onClose,
  gamesPlayed,
}: FeedbackModalProps) {
  const [feedbackType, setFeedbackType] = useState<(typeof FEEDBACK_TYPES)[number]["value"]>("suggestion");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const formspreeUrl = process.env.NEXT_PUBLIC_FORMSPREE_URL?.trim() ?? "";

  useEffect(() => {
    if (!open) return;
    setFeedbackType("suggestion");
    setMessage("");
    setEmail("");
    setStatus("idle");
    setErrorBanner(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const emailTrim = email.trim();
  const emailOk = emailTrim.length === 0 || EMAIL_RE.test(emailTrim);
  const messageTrim = message.trim();
  const loading = status === "loading";
  const canSend =
    messageTrim.length > 0 &&
    messageTrim.length <= 1000 &&
    emailOk &&
    !loading &&
    formspreeUrl.length > 0;

  const handleBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const submit = async () => {
    if (!canSend) return;
    setStatus("loading");
    setErrorBanner(null);
    const timestamp = new Date().toISOString();
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const pageUrl = typeof window !== "undefined" ? window.location.href : "";
    const body = {
      type: feedbackType,
      message: messageTrim,
      email: emailTrim || "",
      gameVersion: "hint_economy",
      timestamp,
      userAgent,
      gamesPlayed,
      deviceType: deviceType(),
      pageUrl,
      _subject: `Hangle feedback: ${feedbackType}`,
      ...(emailTrim ? { _replyto: emailTrim } : {}),
    };

    try {
      const res = await fetch(formspreeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        setErrorBanner("Failed to send. Please try again.");
        return;
      }
      setStatus("success");
      window.setTimeout(() => {
        onClose();
      }, 2000);
    } catch {
      setStatus("error");
      setErrorBanner("Failed to send. Please try again.");
    }
  };

  const charLeft = useMemo(() => 1000 - message.length, [message.length]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex animate-modal-backdrop max-[480px]:items-stretch max-[480px]:p-0 items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
      onClick={handleBackdrop}
    >
      <div
        className="flex max-h-[min(92dvh,100dvh)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-stone-300/70 bg-[#f5f0e8] shadow-2xl animate-modal-panel max-[480px]:max-h-none max-[480px]:min-h-0 max-[480px]:flex-1 max-[480px]:rounded-none sm:max-h-[92dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {status === "success" ? (
            <div className="flex min-h-[12rem] flex-col items-center justify-center py-8 text-center">
              <p className="text-lg font-semibold text-stone-900">✅ Thank you for your feedback!</p>
              <p className="mt-2 text-sm text-stone-600">Closing…</p>
            </div>
          ) : (
            <>
              <h2 id="feedback-title" className="font-serif text-xl font-semibold text-stone-900 sm:text-2xl">
                💬 We&apos;d love to hear from you!
              </h2>
              <p className="mt-1 text-sm text-stone-600">Your feedback helps make Hangle better.</p>

              {!formspreeUrl && (
                <p className="mt-3 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  Feedback is not configured (missing <code className="rounded bg-white/80 px-1">NEXT_PUBLIC_FORMSPREE_URL</code>).
                </p>
              )}

              {errorBanner && (
                <p className="mt-3 rounded-lg border border-red-300/70 bg-red-50 px-3 py-2 text-xs font-medium text-red-900">
                  {errorBanner}
                </p>
              )}

              <fieldset className="mt-5 space-y-2">
                <legend className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                  What kind of feedback?
                </legend>
                <div className="flex flex-col gap-2">
                  {FEEDBACK_TYPES.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-stone-300/60 bg-[#faf7f0] px-3 py-2 text-sm text-stone-800 has-[:checked]:border-amber-500/70 has-[:checked]:bg-amber-50/40"
                    >
                      <input
                        type="radio"
                        name="feedback-type"
                        value={opt.value}
                        checked={feedbackType === opt.value}
                        onChange={() => setFeedbackType(opt.value)}
                        className="h-4 w-4 shrink-0 accent-amber-600"
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="mt-4">
                <label htmlFor="feedback-message" className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                  Your feedback <span className="text-red-700">*</span>
                </label>
                <textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value.slice(0, 1000));
                    if (status === "error") {
                      setStatus("idle");
                      setErrorBanner(null);
                    }
                  }}
                  maxLength={1000}
                  rows={5}
                  placeholder="Tell us anything..."
                  className="mt-1 w-full resize-y rounded-xl border border-stone-300/80 bg-white/90 px-3 py-2 text-sm text-stone-900 shadow-inner outline-none ring-0 transition placeholder:text-stone-400 focus:border-amber-500/70 focus:ring-2 focus:ring-amber-400/35"
                />
                <p className="mt-1 text-right text-[10px] tabular-nums text-stone-500">
                  {message.length}/1000 {charLeft < 200 ? `· ${charLeft} left` : ""}
                </p>
              </div>

              <div className="mt-3">
                <label htmlFor="feedback-email" className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                  Your email (optional)
                </label>
                <input
                  id="feedback-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (status === "error") {
                      setStatus("idle");
                      setErrorBanner(null);
                    }
                  }}
                  placeholder="your@email.com"
                  autoComplete="email"
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-stone-300/80 bg-white/90 px-3 py-2 text-sm text-stone-900 shadow-inner outline-none focus:border-amber-500/70 focus:ring-2 focus:ring-amber-400/35"
                />
                {!emailOk && emailTrim.length > 0 && (
                  <p className="mt-1 text-xs font-medium text-red-700">Please enter a valid email address.</p>
                )}
              </div>

              <p className="mt-4 text-center text-[10px] leading-relaxed text-stone-500">
                Or reach out:{" "}
                <span className="text-stone-400">Reddit</span>
                {" · "}
                <span className="text-stone-400">Twitter</span>
                <span className="block text-stone-400">(links coming soon)</span>
              </p>
            </>
          )}
        </div>

        {status !== "success" && (
          <div className="flex shrink-0 gap-2 border-t border-stone-300/50 bg-[#efe8dc]/90 p-4 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] flex-1 rounded-xl border border-stone-400/70 bg-white px-4 text-sm font-medium text-stone-800 shadow-sm transition hover:bg-stone-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void submit()}
              className="relative min-h-[44px] flex-1 rounded-xl border border-stone-700 bg-stone-800 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                    aria-hidden
                  />
                  Sending…
                </span>
              ) : (
                "Send"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
