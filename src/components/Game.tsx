"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Hangul from "hangul-js";
import wordsJson from "@/data/words.json";
import { Grid } from "@/components/Grid";
import { HangulKeyboard } from "@/components/HangulKeyboard";
import {
  entrySyllableCount,
  getUtcDateString,
  getUtcDayNumber,
  isFullHangulWord,
  pickDailyWord,
  pickPracticeWord,
} from "@/lib/dailyWord";
import { evaluateGuess, tileToEmoji } from "@/lib/evaluate";
import {
  appendPracticeClearedWord,
  defaultStats,
  loadGame,
  loadStats,
  mergeStatsAfterGameEnd,
  resetPracticeSolvedPool,
  saveGame,
  saveStats,
} from "@/lib/storage";
import { assembleBuffer } from "@/lib/hangulBuffer";
import {
  cancelSpeech,
  hangulChunksFromText,
  isSpeechSynthesisSupported,
  playPronunciation,
} from "@/lib/pronunciation";
import { validateWordEntries } from "@/lib/validateWords";
import type { PersistedGame, PuzzleMode, TileState, WordEntry } from "@/types/game";

const WORDS = wordsJson as WordEntry[];

/** Delay after color feedback before next-row draft + hint cues */
const ROW_REVEAL_MS = 300;

type TtsPlayingSlot = "result-word" | "result-example" | "hint-example";

function pickLengthFeedbackMessage(requiredSyllables: number): string {
  const pools: Record<number, string[]> = {
    1: [
      "Need 1 syllable!",
      "한 글자면 돼!",
      "Spell it out!",
      "짧아/길어! One syllable!",
    ],
    2: [
      "Need 2 syllables!",
      "두 글자 필요해!",
      "그것은 너무 짧아!",
      "Type 2 Korean syllables!",
      "거의 다 왔어 — 글자 수만!",
    ],
    3: [
      "Need 3 syllables!",
      "세 글자!",
      "3 syllables — 오! Try again after fixing length!",
    ],
  };
  const list =
    pools[requiredSyllables] ??
    [`Need ${requiredSyllables} syllables!`, `Type ${requiredSyllables} Korean syllables`];
  return list[Math.floor(Math.random() * list.length)]!;
}

function freshGame(
  puzzleDate: string,
  opts?: { mode?: PuzzleMode; practiceAnswer?: string },
): PersistedGame {
  return {
    puzzleDate,
    guesses: [],
    evaluations: [],
    status: "playing",
    statsRecorded: false,
    mode: opts?.mode,
    practiceAnswer: opts?.practiceAnswer,
  };
}

function wordImageSrc(entry: WordEntry): string | undefined {
  const s = entry.image?.trim();
  if (!s) return undefined;
  if (s.startsWith("/") || s.startsWith("http://") || s.startsWith("https://")) {
    return s;
  }
  return undefined;
}

function utcMillisUntilNextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  const next = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(0, next - now);
}

function formatDurationShort(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function Game() {
  const today = useMemo(() => getUtcDateString(), []);
  const dayNumber = useMemo(() => getUtcDayNumber(), []);
  const dailyEntry = useMemo(() => pickDailyWord(WORDS), []);
  const dailyAnswer = dailyEntry.word;

  const [sessionMode, setSessionMode] = useState<PuzzleMode>("daily");
  const [answer, setAnswer] = useState(dailyAnswer);
  const answerEntry = useMemo(
    () => WORDS.find((w) => w.word === answer) ?? dailyEntry,
    [answer, dailyEntry],
  );
  const answerLen = entrySyllableCount(answerEntry);
  const imageSrc = useMemo(() => wordImageSrc(answerEntry), [answerEntry]);

  const [guesses, setGuesses] = useState<string[]>([]);
  const [evaluations, setEvaluations] = useState<TileState[][]>([]);
  const [status, setStatus] = useState<PersistedGame["status"]>("playing");
  const [statsRecorded, setStatsRecorded] = useState(false);
  const [buffer, setBuffer] = useState<string[]>([]);
  const [shakeRow, setShakeRow] = useState<number | null>(null);
  const [draftFlashRed, setDraftFlashRed] = useState(false);
  /** Length / validation feedback above grid (short-lived) */
  const [inputNotice, setInputNotice] = useState<string | null>(null);
  /** Brief pause before showing next-row draft after a valid guess */
  const [rowRevealBlock, setRowRevealBlock] = useState(false);
  const [hintToastVisible, setHintToastVisible] = useState(false);
  const [hintCardPulse, setHintCardPulse] = useState(false);
  /** Tier that just unlocked (1–5); drives brief text emphasis */
  const [freshHintTier, setFreshHintTier] = useState<number | null>(null);
  const hintsTimersRef = useRef<number[]>([]);
  const hintScrollBodyRef = useRef<HTMLDivElement>(null);
  const hintScrollTimerRef = useRef<number | null>(null);
  /** Client-mounted — avoids SSR mismatch for speech checks */
  const [ttsMountReady, setTtsMountReady] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState<null | TtsPlayingSlot>(null);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const speechNoticeTimerRef = useRef<number | null>(null);
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
  /** Same snapshot on server + first client paint; real data applied in hydrate effect */
  const [stats, setStats] = useState(() => defaultStats());
  const [showStats, setShowStats] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);
  const [shareBaseUrl, setShareBaseUrl] = useState("");
  const [endModal, setEndModal] = useState<{ open: boolean; kind: "won" | "lost" }>({
    open: false,
    kind: "won",
  });
  const [countdownTick, setCountdownTick] = useState(0);

  /** Safe strings for UI — words.json or merged entries must never crash on missing fields */
  const safeWordDisplay = useMemo(() => {
    const catRaw = answerEntry?.category ?? "WORD";
    const categoryUpper =
      typeof catRaw === "string" ? catRaw.trim().toUpperCase() || "WORD" : "WORD";
    return {
      categoryUpper,
      meaning: typeof answerEntry?.meaning === "string" ? answerEntry.meaning : "",
      definition: typeof answerEntry?.definition === "string" ? answerEntry.definition : "",
      example: typeof answerEntry?.example === "string" ? answerEntry.example : "",
      emoji: typeof answerEntry?.emoji === "string" ? answerEntry.emoji : "📝",
    };
  }, [answerEntry]);

  const gridDense = answerLen >= 3;

  const firstWordJamo = useMemo(() => {
    const first = answer.charAt(0);
    if (!first) return "";
    const grouped = Hangul.disassemble(first, true) as string[][];
    return grouped[0]?.[0] ?? "";
  }, [answer]);

  const clearHintsTimers = useCallback(() => {
    hintsTimersRef.current.forEach((id) => window.clearTimeout(id));
    hintsTimersRef.current = [];
  }, []);

  useEffect(() => () => clearHintsTimers(), [clearHintsTimers]);

  useEffect(() => {
    setTtsMountReady(true);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const { ok, issues } = validateWordEntries(WORDS);
    if (!ok) {
      console.warn("[words.json] Missing fields in:", issues);
    } else {
      console.log("[words.json] All words validated:", WORDS.length, "entries");
    }
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.log("[Game] Current word entry:", answerEntry);
  }, [answerEntry]);

  const currentRow = guesses.length;

  const speakKoreanWord = useCallback(
    (which: TtsPlayingSlot, text: unknown) => {
      const safe = text != null && typeof text === "string" ? text.trim() : "";
      if (!safe) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[Game] Pronunciation skipped — empty or invalid text, slot:", which, "raw:", text);
        }
        setSpeechNotice("Nothing to pronounce.");
        if (speechNoticeTimerRef.current !== null) window.clearTimeout(speechNoticeTimerRef.current);
        speechNoticeTimerRef.current = window.setTimeout(() => {
          speechNoticeTimerRef.current = null;
          setSpeechNotice(null);
        }, 4000);
        return;
      }
      if (process.env.NODE_ENV === "development") {
        console.log("[Game] Pronunciation slot:", which);
        console.log("[Game] Word for pronunciation:", safe);
        console.log("[Game] answer state:", answer);
      }
      if (!ttsMountReady || !isSpeechSynthesisSupported()) {
        setSpeechNotice("Try Chrome for pronunciation — Korean voices work best there.");
        if (speechNoticeTimerRef.current !== null) window.clearTimeout(speechNoticeTimerRef.current);
        speechNoticeTimerRef.current = window.setTimeout(() => {
          speechNoticeTimerRef.current = null;
          setSpeechNotice(null);
        }, 5000);
        return;
      }
      playPronunciation(safe, {
        onStart: () => setTtsPlaying(which),
        onEnd: () => setTtsPlaying((p) => (p === which ? null : p)),
        onError: () => setTtsPlaying((p) => (p === which ? null : p)),
      });
    },
    [ttsMountReady, answer],
  );

  const triggerShake = () => {
    setShakeRow(currentRow);
    window.setTimeout(() => setShakeRow(null), 400);
  };

  /** Wrong length / incomplete Hangul — shake + draft flash + playful line */
  const rejectBadInput = (message: string) => {
    triggerShake();
    setDraftFlashRed(true);
    setInputNotice(message);
    window.setTimeout(() => setDraftFlashRed(false), 1000);
    window.setTimeout(() => setInputNotice(null), 2200);
  };

  const applyStatsOnce = useCallback(
    (won: boolean, guessCount: number, kind: "daily" | "practice") => {
      let st = mergeStatsAfterGameEnd(loadStats(), won, guessCount, kind);
      if (kind === "practice") {
        st = appendPracticeClearedWord(st, answer);
      }
      saveStats(st);
      setStats(st);
    },
    [answer],
  );

  useEffect(() => {
    setImgBroken(false);
  }, [answer, imageSrc]);

  useEffect(() => {
    cancelSpeech();
    setTtsPlaying(null);
    clearHintsTimers();
    if (hintScrollTimerRef.current !== null) {
      window.clearTimeout(hintScrollTimerRef.current);
      hintScrollTimerRef.current = null;
    }
    setHintToastVisible(false);
    setHintCardPulse(false);
    setFreshHintTier(null);
    setRowRevealBlock(false);
    setInputNotice(null);
  }, [answer, clearHintsTimers]);

  useEffect(() => {
    return () => {
      cancelSpeech();
      if (speechNoticeTimerRef.current !== null) window.clearTimeout(speechNoticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!endModal.open) return;
    setSpeechNotice(null);
    if (speechNoticeTimerRef.current !== null) {
      window.clearTimeout(speechNoticeTimerRef.current);
      speechNoticeTimerRef.current = null;
    }
  }, [endModal.open]);

  /** Keep latest scrollable hint in view inside the card only (no page scroll). */
  useEffect(() => {
    if (!hydrated || status !== "playing") return;
    const body = hintScrollBodyRef.current;
    if (!body) return;
    if (hintScrollTimerRef.current !== null) {
      window.clearTimeout(hintScrollTimerRef.current);
    }
    hintScrollTimerRef.current = window.setTimeout(() => {
      hintScrollTimerRef.current = null;
      body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
    }, ROW_REVEAL_MS + 40);
    return () => {
      if (hintScrollTimerRef.current !== null) {
        window.clearTimeout(hintScrollTimerRef.current);
        hintScrollTimerRef.current = null;
      }
    };
  }, [guesses.length, hydrated, status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const { origin, pathname } = window.location;
    const base =
      pathname === "/" || pathname === ""
        ? `${origin}/`
        : `${origin}${pathname.endsWith("/") ? pathname : `${pathname}/`}`;
    setShareBaseUrl(base);
  }, []);

  useEffect(() => {
    if (!endModal.open) return;
    const id = window.setInterval(() => setCountdownTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [endModal.open]);

  useEffect(() => {
    const loaded = loadGame();
    const st = loadStats();
    setStats(st);

    if (!loaded || loaded.puzzleDate !== today) {
      saveGame(freshGame(today, { mode: "daily" }));
      setSessionMode("daily");
      setAnswer(dailyAnswer);
      setGuesses([]);
      setEvaluations([]);
      setStatus("playing");
      setStatsRecorded(false);
      setBuffer([]);
      setEndModal({ open: false, kind: "won" });
      setHydrated(true);
      return;
    }

    const isPractice = loaded.mode === "practice" && Boolean(loaded.practiceAnswer);
    setSessionMode(isPractice ? "practice" : "daily");
    setAnswer(isPractice ? loaded.practiceAnswer! : dailyAnswer);

    setGuesses(loaded.guesses);
    setEvaluations(loaded.evaluations);
    setStatus(loaded.status);
    setStatsRecorded(loaded.statsRecorded === true);
    setBuffer([]);
    if (loaded.status === "won") {
      setEndModal({ open: true, kind: "won" });
    } else if (loaded.status === "lost") {
      setEndModal({ open: true, kind: "lost" });
    } else {
      setEndModal({ open: false, kind: "won" });
    }
    setHydrated(true);
  }, [today, dailyAnswer]);

  const submitGuess = () => {
    if (status !== "playing" || !hydrated) return;
    if (rowRevealBlock) return;
    const assembled = assembleBuffer(buffer);
    if (!isFullHangulWord(assembled, answerLen)) {
      rejectBadInput(pickLengthFeedbackMessage(answerLen));
      return;
    }

    const attemptNumber = guesses.length + 1;
    const wonImmediate = assembled === answer;
    const lostImmediate = !wonImmediate && attemptNumber >= 6;
    const shouldMoveToNextRow = !wonImmediate && !lostImmediate;

    const ev = evaluateGuess(answer, assembled, {
      attemptNumber,
      shouldMoveToNextRow,
    });
    const nextGuesses = [...guesses, assembled];
    const nextEval = [...evaluations, ev];
    const statsKind = sessionMode === "practice" ? "practice" : "daily";

    const persist = (
      nextStatus: PersistedGame["status"],
      recorded: boolean,
    ) => {
      saveGame({
        puzzleDate: today,
        mode: sessionMode,
        ...(sessionMode === "practice" ? { practiceAnswer: answer } : {}),
        guesses: nextGuesses,
        evaluations: nextEval,
        status: nextStatus,
        statsRecorded: recorded,
      });
    };

    setGuesses(nextGuesses);
    setEvaluations(nextEval);
    setBuffer([]);

    if (wonImmediate) {
      setStatus("won");
      if (!statsRecorded) applyStatsOnce(true, nextGuesses.length, statsKind);
      setStatsRecorded(true);
      persist("won", true);
      setEndModal({ open: true, kind: "won" });
      return;
    }

    if (lostImmediate) {
      setStatus("lost");
      if (!statsRecorded) applyStatsOnce(false, nextGuesses.length, statsKind);
      setStatsRecorded(true);
      persist("lost", true);
      setEndModal({ open: true, kind: "lost" });
      return;
    }

    persist("playing", statsRecorded);

    setRowRevealBlock(true);
    clearHintsTimers();
    const revealId = window.setTimeout(() => {
      setRowRevealBlock(false);
      setHintToastVisible(true);
      setHintCardPulse(true);
      setFreshHintTier(nextGuesses.length);
      hintsTimersRef.current.push(
        window.setTimeout(() => setHintToastVisible(false), 3000),
      );
      hintsTimersRef.current.push(
        window.setTimeout(() => setHintCardPulse(false), 520),
      );
      hintsTimersRef.current.push(
        window.setTimeout(() => setFreshHintTier(null), 2000),
      );
    }, ROW_REVEAL_MS);
    hintsTimersRef.current.push(revealId);
  };

  const handleResultClose = useCallback(() => {
    cancelSpeech();
    setTtsPlaying(null);
    setSpeechNotice(null);
    if (speechNoticeTimerRef.current !== null) {
      window.clearTimeout(speechNoticeTimerRef.current);
      speechNoticeTimerRef.current = null;
    }
    setEndModal((m) => ({ ...m, open: false }));
    clearHintsTimers();
    setHintToastVisible(false);
    setHintCardPulse(false);
    setFreshHintTier(null);
    setRowRevealBlock(false);
    setInputNotice(null);
    if (status !== "won" && status !== "lost") return;

    // TODO: Premium 도입 시 여기서 게임 횟수 제한

    const st0 = loadStats();
    const { entry, clearedSolved } = pickPracticeWord(
      WORDS,
      st0.practiceSolvedWords ?? [],
      dailyAnswer,
    );
    if (clearedSolved) {
      const st = resetPracticeSolvedPool(st0);
      saveStats(st);
      setStats(st);
    }

    const nextAnswer = entry.word;
    setSessionMode("practice");
    setAnswer(nextAnswer);
    setGuesses([]);
    setEvaluations([]);
    setStatus("playing");
    setStatsRecorded(false);
    setBuffer([]);
    saveGame({
      puzzleDate: today,
      mode: "practice",
      practiceAnswer: nextAnswer,
      guesses: [],
      evaluations: [],
      status: "playing",
      statsRecorded: false,
    });
  }, [status, today, dailyAnswer, clearHintsTimers]);

  const shareText = useMemo(() => {
    const lines = evaluations
      .filter((row) => row.length === answer.length)
      .map((row) => row.map(tileToEmoji).join(""));
    const resultLine =
      status === "won" ? `${guesses.length}/6` : status === "lost" ? "X/6" : "";
    const modeTag = sessionMode === "practice" ? " (Practice)" : "";
    const syllableNote =
      answer.length === 1
        ? "1 syllable"
        : `${answer.length} syllables`;
    const body = [
      `Hangle #${dayNumber}${modeTag} ${resultLine}`,
      ...lines,
      "",
      `hangle — Korean spelling (${syllableNote}, learning mode · UTC)`,
    ];
    if (shareBaseUrl) {
      body.push("", shareBaseUrl);
    }
    return body.join("\n");
  }, [
    evaluations,
    guesses.length,
    status,
    dayNumber,
    shareBaseUrl,
    sessionMode,
    answer.length,
  ]);

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setClipboardNotice("Copied.");
      window.setTimeout(() => setClipboardNotice(null), 2000);
    } catch {
      setClipboardNotice("Could not copy.");
      window.setTimeout(() => setClipboardNotice(null), 2000);
    }
  };

  const nativeShare = async () => {
    if (!navigator.share) {
      copyShare();
      return;
    }
    try {
      await navigator.share({ title: "Hangle", text: shareText });
    } catch {
      /* user cancelled */
    }
  };

  const winRate =
    stats.gamesPlayed > 0
      ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
      : 0;
  const avgGuesses =
    stats.gamesWon > 0
      ? (stats.totalGuessesOnWins / stats.gamesWon).toFixed(1)
      : "—";

  const showImage = Boolean(imageSrc && !imgBroken);
  void countdownTick;
  const msToNextUtc = utcMillisUntilNextUtcMidnight();
  const nextWordLine = `Tomorrow's word in ${formatDurationShort(msToNextUtc)} (UTC)`;
  const playedToday =
    stats.utcStatsDate === today ? (stats.gamesFinishedToday ?? 0) : 0;

  const hintsUnlocked = Math.min(guesses.length, 5);
  const newestScrollTier =
    guesses.length >= 5
      ? 5
      : guesses.length >= 4
        ? 4
        : guesses.length >= 3
          ? 3
          : guesses.length >= 2
            ? 2
            : null;

  const nextHintSubtitle = useMemo(() => {
    if (hintsUnlocked >= 5) return "All 5 hints unlocked.";
    if (guesses.length === 0) return "Hint 1 unlocks after your first guess.";
    return `Hint ${hintsUnlocked + 1} unlocks after your next guess.`;
  }, [hintsUnlocked, guesses.length]);

  const scrollHintRowClass = (tier: number) => {
    const dim = newestScrollTier !== null && tier < newestScrollTier;
    const freshBg = freshHintTier === tier;
    return [
      "rounded-md px-1 py-0.5",
      dim ? "hint-scroll-row-dim" : "",
      freshBg ? "hint-row-bg-fresh" : "",
    ]
      .filter(Boolean)
      .join(" ");
  };

  /** Non-empty trimmed answer for UI + TTS (avoids `"" || x` collapsing to undefined) */
  const safeAnswerForTts = useMemo(() => {
    if (typeof answer !== "string") return "";
    return answer.trim();
  }, [answer]);

  const exampleKoreanForTts = useMemo(() => {
    const fromExample = hangulChunksFromText(safeWordDisplay.example);
    const merged = (fromExample || safeAnswerForTts).trim();
    return merged;
  }, [safeWordDisplay.example, safeAnswerForTts]);

  const speechUnavailable = ttsMountReady && !isSpeechSynthesisSupported();

  return (
    <div
      className="mx-auto flex h-[100dvh] max-h-[100dvh] min-h-0 w-full max-w-[500px] flex-col gap-1 overflow-hidden px-2 pt-[max(0.1rem,env(safe-area-inset-top))] pb-[max(0.15rem,env(safe-area-inset-bottom))] font-sans text-stone-800 sm:gap-1.5 sm:px-3"
    >
      <header className="flex shrink-0 flex-col gap-0">
        <div className="flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={() => setShowStats(true)}
            className="min-h-[28px] min-w-[2.5rem] shrink-0 rounded-md px-1.5 py-0.5 text-[9px] text-stone-600 hover:bg-stone-200/60 hover:text-stone-900 sm:min-h-[32px] sm:px-2 sm:py-1 sm:text-xs"
          >
            Stats
          </button>
          <div className="flex min-w-0 flex-1 flex-col items-center gap-0 px-1">
            <h1 className="font-serif text-lg leading-none tracking-tight text-stone-900 sm:text-2xl">
              Hangle
            </h1>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide sm:text-[11px] ${
                sessionMode === "daily"
                  ? "border-amber-400/80 bg-amber-50 text-amber-900"
                  : "border-stone-400/60 bg-stone-100 text-stone-700"
              }`}
            >
              {sessionMode === "daily" ? "Today's word" : "Practice"}
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              (status === "won" || status === "lost") &&
              setEndModal({ open: true, kind: status === "won" ? "won" : "lost" })
            }
            className={`min-h-[28px] min-w-[2.5rem] shrink-0 rounded-md px-1.5 py-0.5 text-[9px] sm:min-h-[32px] sm:px-2 sm:py-1 sm:text-xs ${
              status === "won" || status === "lost"
                ? "text-stone-600 hover:bg-stone-200/60 hover:text-stone-900"
                : "pointer-events-none invisible"
            }`}
          >
            Summary
          </button>
        </div>
        <p className="text-center text-[8px] tabular-nums leading-tight text-stone-500 sm:text-[10px]">
          Today · {playedToday} played
        </p>
      </header>

      <p className="line-clamp-2 shrink-0 text-balance text-center text-[9px] leading-tight text-stone-500 max-[667px]:text-[8px] sm:text-[10px] sm:leading-snug">
        {sessionMode === "daily" ? (
          <>
            Hints unlock each guess · {answerLen}{" "}
            {answerLen === 1 ? "syllable" : "syllables"} · 6 tries · UTC
          </>
        ) : (
          <>Practice · hints stack · streak = daily only</>
        )}
      </p>

      {hydrated && status === "playing" && (
        <div className="relative z-[1] w-full shrink-0">
          {hintToastVisible && (
            <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 flex -translate-x-1/2 justify-center">
              <div
                role="status"
                aria-live="polite"
                className="animate-hint-toast whitespace-nowrap rounded-full border border-amber-400/80 bg-amber-50/95 px-3 py-1 font-sans text-[10px] font-semibold text-amber-950 shadow-md backdrop-blur-[2px] sm:text-[11px]"
              >
                💡 New hint!
              </div>
            </div>
          )}
          <section
            aria-label="Hints"
            className={`flex max-h-[150px] shrink-0 flex-col overflow-hidden rounded-xl border border-stone-300/55 bg-[var(--hint-card-bg)] shadow-sm transition-shadow sm:max-h-[200px] ${hintCardPulse ? "hint-card-pulse-once" : ""}`}
          >
            {/* Fixed header: progress + emoji + category + meaning (once unlocked) */}
            <div className="shrink-0 border-b border-stone-400/25 px-4 pb-3 pt-4 text-left sm:px-5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-serif text-[11px] font-semibold tabular-nums text-stone-800 sm:text-xs">
                  Hint {hintsUnlocked}/5
                </span>
                <div className="flex shrink-0 gap-1" aria-hidden>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-1.5 rounded-full ${
                        i < hintsUnlocked ? "bg-amber-600" : "bg-stone-300/90"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <p className="mt-1 text-[9px] leading-snug text-stone-500 sm:text-[10px]">{nextHintSubtitle}</p>

              <div className="mt-2 flex items-center gap-2.5">
                {showImage && imageSrc ? (
                  <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-stone-300/50 bg-white/80">
                    <Image
                      src={imageSrc}
                      alt=""
                      fill
                      sizes="40px"
                      className="object-cover"
                      onError={() => setImgBroken(true)}
                    />
                  </div>
                ) : (
                  <span
                    className="flex h-10 w-10 shrink-0 select-none items-center justify-center text-[1.65rem] leading-none sm:text-[1.75rem]"
                    style={{
                      fontFamily:
                        "system-ui, 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif",
                    }}
                    aria-hidden
                  >
                    {safeWordDisplay.emoji}
                  </span>
                )}
                <span className="max-w-[min(100%,14rem)] truncate rounded-full border border-stone-400/55 bg-white/40 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-stone-800">
                  {safeWordDisplay.categoryUpper}
                </span>
              </div>

              {guesses.length >= 1 ? (
                <div
                  className={`mt-2 rounded-md px-1 py-1 ${freshHintTier === 1 ? "hint-row-bg-fresh" : ""}`}
                >
                  <p className="hint-scroll-row-title text-[8px] font-semibold uppercase tracking-wide text-stone-500">
                    Meaning
                  </p>
                  <p className="font-serif text-[12px] leading-snug text-stone-900 sm:text-[13px]">
                    &ldquo;{safeWordDisplay.meaning}&rdquo;
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-[11px] font-medium leading-snug text-stone-600">
                  Try to guess the Korean word!
                </p>
              )}
            </div>

            {/* Scroll body: incremental hints (definition → jamo → keyboard note → example) */}
            <div
              ref={hintScrollBodyRef}
              className="hint-card-inner-scroll flex min-h-0 flex-1 flex-col divide-y divide-stone-400/25 overflow-y-auto overscroll-contain px-4 pb-4 pt-2 sm:px-5"
            >
              {guesses.length >= 2 && (
                <div className={`hint-fade-in py-2 ${scrollHintRowClass(2)}`}>
                  <p className="hint-scroll-row-title text-[8px] font-semibold uppercase tracking-wide text-stone-500">
                    Definition
                  </p>
                  <p className="text-[11px] leading-snug text-stone-800 sm:text-xs">{safeWordDisplay.definition}</p>
                </div>
              )}

              {guesses.length >= 3 && firstWordJamo && (
                <div className={`hint-fade-in py-2 ${scrollHintRowClass(3)}`}>
                  <p className="text-[11px] font-semibold leading-snug text-stone-900 sm:text-xs">
                    Starts with{" "}
                    <span className="font-mono text-sm tracking-wide text-stone-950">{firstWordJamo}</span>
                  </p>
                </div>
              )}

              {guesses.length >= 4 && (
                <div className={`hint-fade-in py-2 ${scrollHintRowClass(4)}`}>
                  <p className="hint-scroll-row-title text-[8px] font-semibold uppercase tracking-wide text-stone-500">
                    Keyboard
                  </p>
                  <p className="text-[11px] leading-snug text-stone-800 sm:text-xs">
                    Jamo used in the answer are highlighted on the keyboard below.
                  </p>
                </div>
              )}

              {guesses.length >= 5 && (
                <div className={`hint-fade-in py-2 ${scrollHintRowClass(5)}`}>
                  <p className="mb-1 text-center text-[9px] font-bold uppercase tracking-wide text-red-700">
                    Last chance!
                  </p>
                  <div className="flex items-start justify-between gap-2">
                    <p className="hint-scroll-row-title text-[8px] font-semibold uppercase tracking-wide text-stone-500">
                      Example
                    </p>
                    {exampleKoreanForTts ? (
                      <button
                        type="button"
                        onClick={() => speakKoreanWord("hint-example", exampleKoreanForTts)}
                        aria-label="Listen to Korean pronunciation from this example"
                        className={`shrink-0 rounded-md border border-stone-400/70 bg-white/90 px-2 py-1 text-[13px] leading-none text-stone-800 shadow-sm transition hover:bg-white active:scale-95 ${ttsPlaying === "hint-example" ? "ring-2 ring-amber-400/75 bg-amber-50/90" : ""}`}
                      >
                        🔊
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-stone-900 sm:text-xs">{safeWordDisplay.example}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden pt-0.5">
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden">
          <div className="flex w-full max-w-[min(100%,22rem)] shrink-0 flex-col items-center gap-1 px-0.5 py-0">
            {inputNotice && (
              <p
                key={inputNotice}
                role="alert"
                className="animate-dict-notice max-[667px]:text-[11px] text-center text-[12px] font-semibold text-red-700"
              >
                {inputNotice}
              </p>
            )}
            <div className="flex w-full shrink-0 justify-center py-0">
              <Grid
                guesses={guesses}
                evaluations={evaluations}
                currentRow={currentRow}
                buffer={buffer}
                shakeRow={shakeRow}
                draftFlashRed={draftFlashRed}
                suppressDraft={rowRevealBlock}
                status={status}
                answerLength={answerLen}
                dense={gridDense}
              />
            </div>
          </div>
        </div>

        <div className="mt-auto w-full shrink-0 pb-0 pt-0.5">
          <HangulKeyboard
            buffer={buffer}
            onBufferChange={setBuffer}
            onEnter={submitGuess}
            disabled={status !== "playing" || !hydrated}
            enterPaused={rowRevealBlock}
            targetSyllables={answerLen}
            highlightAnswer={guesses.length >= 4 ? answer : ""}
          />
        </div>
      </div>

      {showStats && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stats-title"
          onClick={() => setShowStats(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-stone-200 bg-[#fafaf9] p-6 font-sans shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="stats-title" className="mb-4 font-serif text-2xl text-stone-900">
              Statistics
            </h2>
            <div className="mb-6 grid grid-cols-4 gap-3 text-center">
              <div>
                <div className="text-2xl font-semibold">{stats.gamesPlayed}</div>
                <div className="text-xs text-stone-500">Played</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">{winRate}</div>
                <div className="text-xs text-stone-500">Win %</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">{stats.currentStreak}</div>
                <div className="text-xs text-stone-500">Streak</div>
              </div>
              <div>
                <div className="text-2xl font-semibold">{stats.maxStreak}</div>
                <div className="text-xs text-stone-500">Max</div>
              </div>
            </div>
            <p className="mb-4 text-sm text-stone-600">
              Average guesses when you win:{" "}
              <span className="font-medium">{avgGuesses}</span>
            </p>
            <p className="mb-4 text-sm text-stone-600">
              Solved in one guess (all time):{" "}
              <span className="font-medium">{stats.oneGuessWins ?? 0}</span>
            </p>
            <p className="mb-2 text-xs uppercase tracking-wide text-stone-500">Guess distribution</p>
            <div className="mb-6 flex flex-col gap-1">
              {(() => {
                const max = Math.max(...stats.guessDistribution, 1);
                return stats.guessDistribution.map((count, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="w-3 tabular-nums text-stone-500">{i + 1}</span>
                    <div className="flex h-6 flex-1 overflow-hidden rounded bg-stone-200">
                      <div
                        className="flex h-full min-w-0 items-center justify-end bg-stone-600 pr-2 text-xs text-white transition-all"
                        style={{
                          width: count === 0 ? "0%" : `${(count / max) * 100}%`,
                          minWidth: count > 0 ? "1.75rem" : undefined,
                        }}
                      >
                        {count > 0 ? count : ""}
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>
            <button
              type="button"
              className="w-full rounded-md bg-stone-800 py-2.5 text-sm text-white hover:bg-stone-700 min-h-[44px]"
              onClick={() => setShowStats(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {endModal.open && (status === "won" || status === "lost") && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="result-title"
          onClick={handleResultClose}
        >
          <div
            className="max-h-[min(90dvh,640px)] w-full max-w-sm overflow-y-auto rounded-xl border border-stone-200 bg-[#fafaf9] p-6 font-sans shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="result-title" className="font-serif text-xl text-stone-900 sm:text-2xl">
              {endModal.kind === "won" ? "🎉 정답!" : "Better luck next time!"}
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              {endModal.kind === "won"
                ? `You got it! · ${guesses.length}/6`
                : `${guesses.length}/6 tries`}
            </p>

            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
              {endModal.kind === "lost" ? "The word was" : "정답"}
            </p>
            {safeAnswerForTts ? (
              <p className="mt-1 font-serif text-3xl font-semibold text-stone-900">{answer}</p>
            ) : (
              <p className="mt-1 text-sm text-stone-500">Word unavailable — close and try again.</p>
            )}

            {speechUnavailable && (
              <p className="mt-2 text-[11px] leading-snug text-stone-500">
                Try Chrome for pronunciation — Korean voices work best there (Windows, Mac, Android,
                iOS).
              </p>
            )}

            {safeAnswerForTts ? (
              <button
                type="button"
                onClick={() => speakKoreanWord("result-word", safeAnswerForTts)}
                aria-label="Listen to pronunciation of the answer word"
                className={`mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-stone-400/80 bg-white px-4 py-3 text-sm font-semibold text-stone-900 shadow-sm transition hover:bg-stone-50 active:scale-[0.99] ${ttsPlaying === "result-word" ? "border-amber-500/70 bg-amber-50 ring-2 ring-amber-400/60" : ""}`}
              >
                <span className="text-xl leading-none" aria-hidden>
                  🔊
                </span>
                Listen to pronunciation
              </button>
            ) : null}

            {speechNotice && (
              <p className="mt-2 text-center text-[11px] font-medium text-amber-900/90" role="status">
                {speechNotice}
              </p>
            )}

            <p className="mt-3 text-sm text-stone-600">&ldquo;{safeWordDisplay.meaning}&rdquo;</p>
            <p className="mt-1 text-xs leading-snug text-stone-600">{safeWordDisplay.definition}</p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wide text-stone-500">Example</p>
              {exampleKoreanForTts ? (
                <button
                  type="button"
                  onClick={() => speakKoreanWord("result-example", exampleKoreanForTts)}
                  aria-label="Listen to Korean phrases from this example"
                  className={`shrink-0 rounded-lg border border-stone-400/80 bg-white px-3 py-2 text-base leading-none text-stone-800 shadow-sm hover:bg-stone-50 active:scale-95 ${ttsPlaying === "result-example" ? "border-amber-500/70 bg-amber-50 ring-2 ring-amber-400/60" : ""}`}
                >
                  🔊
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-stone-800">{safeWordDisplay.example}</p>

            <div className="mt-5 rounded-lg border border-stone-200/80 bg-white/60 px-3 py-3 text-sm text-stone-600">
              <p>
                <span className="text-stone-400">Current streak · </span>
                <span className="font-semibold text-stone-900">{stats.currentStreak}</span>
              </p>
              <p className="mt-1 text-xs text-stone-500">
                {sessionMode === "daily"
                  ? nextWordLine
                  : `Practice round · next official word in ${formatDurationShort(msToNextUtc)} (UTC)`}
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              {clipboardNotice && (
                <p className="text-center text-xs font-medium text-stone-600" role="status">
                  {clipboardNotice}
                </p>
              )}
              <button
                type="button"
                onClick={copyShare}
                className="w-full rounded-md bg-stone-800 py-2.5 text-sm text-white hover:bg-stone-700 min-h-[44px]"
              >
                Copy results + link
              </button>
              {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                <button
                  type="button"
                  onClick={nativeShare}
                  className="w-full rounded-md border border-stone-300 bg-white py-2.5 text-sm hover:bg-stone-50 min-h-[44px]"
                >
                  Share
                </button>
              )}
              <button
                type="button"
                className="w-full rounded-md border border-stone-300 bg-white py-2.5 text-sm hover:bg-stone-50 min-h-[44px]"
                onClick={handleResultClose}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
