/** Hangul syllables only — strip English etc. for clearer Korean TTS on mixed examples */
export function hangulChunksFromText(s: string | undefined | null): string {
  if (s == null || typeof s !== "string") return "";
  const parts = s.match(/[\uAC00-\uD7A3]+/g);
  return parts?.join(" ").trim() ?? "";
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export type SpeakCallbacks = {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
};

/**
 * Built-in browser TTS (no API keys). Prefer Chrome for best ko-KR voices.
 */
export function playPronunciation(text: unknown, callbacks?: SpeakCallbacks): boolean {
  if (text == null || typeof text !== "string") {
    if (process.env.NODE_ENV === "development") {
      console.warn("[pronunciation] No word to pronounce:", text);
    }
    callbacks?.onError?.();
    return false;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[pronunciation] Empty string after trim");
    }
    callbacks?.onError?.();
    return false;
  }

  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    callbacks?.onError?.();
    return false;
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[pronunciation] Word for pronunciation:", trimmed);
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.lang = "ko-KR";
  utterance.rate = 0.8;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  utterance.onstart = () => callbacks?.onStart?.();
  utterance.onend = () => callbacks?.onEnd?.();
  utterance.onerror = () => callbacks?.onError?.();

  window.speechSynthesis.speak(utterance);
  return true;
}

export function cancelSpeech(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
