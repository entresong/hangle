/** Hangul syllables only — strip English etc. for clearer Korean TTS on mixed examples */
export function hangulChunksFromText(s: string | undefined | null): string {
  if (s == null || typeof s !== "string") return "";
  const parts = s.match(/[\uAC00-\uD7A3]+/g);
  return parts?.join(" ").trim() ?? "";
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function scoreKoreanVoice(v: SpeechSynthesisVoice): number {
  const lang = (v.lang || "").toLowerCase();
  if (!lang.startsWith("ko")) return -1;
  let s = 0;
  const meta = `${v.name} ${v.voiceURI}`.toLowerCase();
  if (v.localService) s += 4;
  if (meta.includes("premium")) s += 10;
  if (meta.includes("enhanced")) s += 6;
  if (lang === "ko-kr" || lang === "ko_kr") s += 3;
  else if (lang.startsWith("ko")) s += 1;
  return s;
}

function pickBestKoreanVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const ranked = voices
    .map((v) => ({ v, s: scoreKoreanVoice(v) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);
  return ranked[0]?.v ?? null;
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
  utterance.rate = 0.85;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  const bindVoice = () => {
    const best = pickBestKoreanVoice();
    if (best) utterance.voice = best;
  };
  bindVoice();
  if (window.speechSynthesis.getVoices().length === 0) {
    const onVoices = () => {
      bindVoice();
      window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
    };
    window.speechSynthesis.addEventListener("voiceschanged", onVoices);
  }

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
