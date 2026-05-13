"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Hangul from "hangul-js";
import wordsJson from "@/data/words.json";
import { FeedbackModal } from "@/components/FeedbackModal";
import { Grid } from "@/components/Grid";
import { HangulKeyboard } from "@/components/HangulKeyboard";
import { MaskedPlaceholderText } from "@/components/MaskedPlaceholderText";
import {
  entrySyllableCount,
  getUtcDateString,
  getUtcDayNumber,
  isFullHangulWord,
  pickDailyWord,
  pickPracticeWord,
} from "@/lib/dailyWord";
import { evaluateGuess } from "@/lib/evaluate";
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
import {
  difficultyBadgeLabel,
  loadDifficulty,
  saveDifficulty,
  type Difficulty,
} from "@/lib/difficulty";
import { assembleBuffer } from "@/lib/hangulBuffer";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import { maskAnswerInText } from "@/lib/maskAnswerInText";
import {
  cancelSpeech,
  hangulChunksFromText,
  isSpeechSynthesisSupported,
  playPronunciation,
} from "@/lib/pronunciation";
import phrasesJson from "@/data/phrases.json";
import { TodayPhraseBonus } from "@/components/TodayPhraseBonus";
import { WelcomeHelpModal } from "@/components/WelcomeHelpModal";
import { getNextPhrase } from "@/lib/phraseRotation";
import { validateWordEntries } from "@/lib/validateWords";
import { getVisibleHints } from "@/lib/visibleHints";
import { buildViralShareText } from "@/lib/viralShareText";
import { CONTEXT_EMOJI, formatExampleHintLine, getWordExamples } from "@/lib/wordExamples";
import type { PhraseEntry } from "@/types/phrase";
import type { PersistedGame, PuzzleMode, TileState, WordEntry } from "@/types/game";

const WORDS = wordsJson as WordEntry[];
const PHRASES = phrasesJson as PhraseEntry[];

const HANGLE_VISITED_KEY = "hangle_visited";

/** Delay after color feedback before next-row draft + hint cues */
const ROW_REVEAL_MS = 300;

/** How long the “Brag” clipboard toast stays visible (read time on mobile). */
const BRAG_TOAST_MS = 3800;

type TtsPlayingSlot = "result-word" | "bonus-phrase" | "bonus-example" | "rex-0" | "rex-1" | "rex-2";

function pickLengthFeedbackMessage(requiredSyllables: number): string {
  const pools: Record<number, string[]> = {
    1: [
      "Need 1 syllable!",
      "Just 1 syllable — short and sweet!",
      "Spell it out — one block!",
      "One syllable, you got this!",
    ],
    2: [
      "Need 2 syllables!",
      "Type 2 Korean syllables!",
      "Two blocks, please!",
      "Almost — just 2 syllables!",
      "Fix the length — 2 syllables!",
    ],
    3: [
      "Need 3 syllables!",
      "Three syllables!",
      "3 syllables — fix length and try again!",
      "Three blocks — you got this!",
    ],
  };
  const list =
    pools[requiredSyllables] ??
    [`Need ${requiredSyllables} syllables!`, `Type ${requiredSyllables} Korean syllables`];
  return list[Math.floor(Math.random() * list.length)]!;
}

/** Last-chance strip: reveal all syllables but the last. */
function almostAnswerLine(answer: string): string {
  const arr = Array.from(answer);
  if (arr.length <= 1) return "One syllable — almost there!";
  return `${arr.slice(0, -1).join("")} · ?`;
}

/** Scroll / header row tier that just unlocked (drives toast + emphasis). */
function freshUnlockedHintTier(
  d: Difficulty,
  prevWrong: number,
  newWrong: number,
): number | null {
  if (newWrong <= prevWrong) return null;
  if (d === "hard") {
    if (newWrong === 5) return 7;
    return null;
  }
  if (d === "normal") {
    if (newWrong === 3) return 1;
    if (newWrong === 5) return 5;
    return null;
  }
  if (newWrong === 1) return 2;
  if (newWrong === 2) return 3;
  if (newWrong === 3) return 4;
  if (newWrong === 4) return 5;
  if (newWrong === 5) return 6;
  return null;
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

  const [bonusPhrase, setBonusPhrase] = useState<PhraseEntry | null>(null);
  const bonusPhraseExampleKo = useMemo(
    () => (bonusPhrase ? hangulChunksFromText(bonusPhrase.example) : ""),
    [bonusPhrase],
  );

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
  const [shareActionNotice, setShareActionNotice] = useState<string | null>(null);
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

  /** Saved preference; null until first pick from LS */
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [pickDifficultyOpen, setPickDifficultyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [modeToast, setModeToast] = useState<string | null>(null);
  const modeToastTimerRef = useRef<number | null>(null);
  const [welcomeHelpOpen, setWelcomeHelpOpen] = useState(false);
  const [tapHintConsumed, setTapHintConsumed] = useState(false);

  /** Safe strings for UI — words.json or merged entries must never crash on missing fields */
  const safeWordDisplay = useMemo(() => {
    const catRaw = answerEntry?.category ?? "WORD";
    const categoryUpper =
      typeof catRaw === "string" ? catRaw.trim().toUpperCase() || "WORD" : "WORD";
    const examples = getWordExamples(answerEntry ?? undefined);
    return {
      categoryUpper,
      meaning: typeof answerEntry?.meaning === "string" ? answerEntry.meaning : "",
      definition: typeof answerEntry?.definition === "string" ? answerEntry.definition : "",
      examples,
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
    const d = loadDifficulty();
    if (d) {
      setDifficulty(d);
    } else {
      setPickDifficultyOpen(true);
    }
  }, []);

  const flashModeToast = useCallback((d: Difficulty) => {
    const label = d === "easy" ? "EASY" : d === "normal" ? "NORMAL" : "HARD";
    setModeToast(`Now playing on ${label} mode`);
    if (modeToastTimerRef.current !== null) window.clearTimeout(modeToastTimerRef.current);
    modeToastTimerRef.current = window.setTimeout(() => {
      modeToastTimerRef.current = null;
      setModeToast(null);
    }, 2800);
  }, []);

  useEffect(() => {
    return () => {
      if (modeToastTimerRef.current !== null) window.clearTimeout(modeToastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setTtsMountReady(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (window.localStorage.getItem(HANGLE_VISITED_KEY) !== "true") {
        setWelcomeHelpOpen(true);
      }
    } catch {
      /* ignore */
    }
  }, [hydrated]);

  useEffect(() => {
    setTapHintConsumed(false);
  }, [answer]);

  useEffect(() => {
    if (buffer.length > 0) setTapHintConsumed(true);
  }, [buffer.length]);

  const closeWelcomeHelp = useCallback(() => {
    setWelcomeHelpOpen(false);
  }, []);

  const markVisitedAndCloseWelcome = useCallback(() => {
    try {
      window.localStorage.setItem(HANGLE_VISITED_KEY, "true");
    } catch {
      /* ignore */
    }
    setWelcomeHelpOpen(false);
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
  const wrongGuessCount = guesses.filter((g) => g !== answer).length;

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

  /** Keep latest scrollable hint in view (Normal/Hard). Easy uses per-tier scrollIntoView. */
  useEffect(() => {
    if (!hydrated || status !== "playing") return;
    if (difficulty === "easy") return;
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
  }, [guesses.length, wrongGuessCount, difficulty, hydrated, status]);

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
      setBonusPhrase(null);
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

    if (loaded.status === "won" || loaded.status === "lost") {
      let entry: PhraseEntry;
      if (typeof loaded.bonusPhraseId === "number") {
        entry = PHRASES.find((p) => p.id === loaded.bonusPhraseId) ?? PHRASES[0]!;
      } else {
        entry = getNextPhrase(PHRASES);
        saveGame({ ...loaded, bonusPhraseId: entry.id });
      }
      setBonusPhrase(entry);
    } else {
      setBonusPhrase(null);
    }

    setHydrated(true);
  }, [today, dailyAnswer]);

  const submitGuess = () => {
    if (status !== "playing" || !hydrated) return;
    if (rowRevealBlock) return;
    if (!difficulty) return;
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
    const prevWrong = guesses.filter((g) => g !== answer).length;
    const newWrong = nextGuesses.filter((g) => g !== answer).length;
    const hintTierUnlocked =
      wonImmediate || lostImmediate
        ? null
        : freshUnlockedHintTier(difficulty!, prevWrong, newWrong);

    if (process.env.NODE_ENV === "development" && difficulty === "easy" && !wonImmediate && !lostImmediate) {
      const v = getVisibleHints("easy", newWrong);
      console.log("=== After attempt #", attemptNumber, "===");
      console.log("Wrong guesses:", newWrong, "(was", prevWrong, ")");
      console.log("Meaning shown:", true);
      console.log("Definition shown:", newWrong >= 1, "| visible.showDefinition:", v.showDefinition);
      console.log("Example shown:", newWrong >= 2, "| visible.showExample:", v.showExample);
      console.log("Jamo text shown:", newWrong >= 3, "| visible.showJamo:", v.showJamo);
      console.log("Keyboard highlighted:", newWrong >= 4, "| showKeyboardHelpRow:", v.showKeyboardHelpRow);
      console.log("Last-chance strip:", newWrong >= 5, "| lastChanceEasy:", v.lastChanceEasy);
      console.log("Hint tier unlocked this submit:", hintTierUnlocked);
    }

    const persist = (
      nextStatus: PersistedGame["status"],
      recorded: boolean,
      bonusPhraseId?: number,
    ) => {
      saveGame({
        puzzleDate: today,
        mode: sessionMode,
        ...(sessionMode === "practice" ? { practiceAnswer: answer } : {}),
        guesses: nextGuesses,
        evaluations: nextEval,
        status: nextStatus,
        statsRecorded: recorded,
        ...(typeof bonusPhraseId === "number" ? { bonusPhraseId } : {}),
      });
    };

    setGuesses(nextGuesses);
    setEvaluations(nextEval);
    setBuffer([]);

    if (wonImmediate) {
      const picked = getNextPhrase(PHRASES);
      setBonusPhrase(picked);
      setStatus("won");
      if (!statsRecorded) applyStatsOnce(true, nextGuesses.length, statsKind);
      setStatsRecorded(true);
      persist("won", true, picked.id);
      setEndModal({ open: true, kind: "won" });
      return;
    }

    if (lostImmediate) {
      const picked = getNextPhrase(PHRASES);
      setBonusPhrase(picked);
      setStatus("lost");
      if (!statsRecorded) applyStatsOnce(false, nextGuesses.length, statsKind);
      setStatsRecorded(true);
      persist("lost", true, picked.id);
      setEndModal({ open: true, kind: "lost" });
      return;
    }

    persist("playing", statsRecorded);

    setRowRevealBlock(true);
    clearHintsTimers();
    const revealId = window.setTimeout(() => {
      setRowRevealBlock(false);
      if (hintTierUnlocked !== null) {
        setHintToastVisible(true);
        setHintCardPulse(true);
        setFreshHintTier(hintTierUnlocked);
        hintsTimersRef.current.push(
          window.setTimeout(() => setHintToastVisible(false), 3000),
        );
        hintsTimersRef.current.push(
          window.setTimeout(() => setHintCardPulse(false), 800),
        );
        hintsTimersRef.current.push(
          window.setTimeout(() => setFreshHintTier(null), 2000),
        );
      } else {
        setHintToastVisible(false);
        setHintCardPulse(false);
        setFreshHintTier(null);
      }
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
    setBonusPhrase(null);
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
    if (status !== "won" && status !== "lost") return "";
    return buildViralShareText({
      dayNumber,
      sessionMode,
      status,
      guessCount: guesses.length,
      difficulty: difficulty ?? "easy",
      evaluations,
      answerLength: answer.length,
      shareBaseUrl: shareBaseUrl || "https://hangle-three.vercel.app/",
    });
  }, [
    status,
    dayNumber,
    sessionMode,
    guesses.length,
    difficulty,
    evaluations,
    answer.length,
    shareBaseUrl,
  ]);

  const handleBragCopy = useCallback(async () => {
    if (!shareText) {
      setShareActionNotice("Play a round first — then brag here.");
      window.setTimeout(() => setShareActionNotice(null), 2400);
      return;
    }
    const ok = await copyTextToClipboard(shareText);
    setShareActionNotice(
      ok
        ? "Copied! Show off your Korean skills 👑"
        : "Could not copy — check browser permissions and try again.",
    );
    window.setTimeout(() => setShareActionNotice(null), ok ? BRAG_TOAST_MS : 3200);
  }, [shareText]);

  const handleTweetShare = useCallback(() => {
    if (!shareText) {
      setShareActionNotice("Nothing to share yet.");
      window.setTimeout(() => setShareActionNotice(null), 2200);
      return;
    }
    if (process.env.NODE_ENV === "development") {
      console.log("Share: X clicked");
    }
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setShareActionNotice("Opening X / Twitter…");
    window.setTimeout(() => setShareActionNotice(null), 2000);
  }, [shareText]);

  const handleWhatsAppShare = useCallback(() => {
    if (!shareText) {
      setShareActionNotice("Nothing to share yet.");
      window.setTimeout(() => setShareActionNotice(null), 2200);
      return;
    }
    if (process.env.NODE_ENV === "development") {
      console.log("Share: WhatsApp clicked");
    }
    const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setShareActionNotice("Opening WhatsApp…");
    window.setTimeout(() => setShareActionNotice(null), 2000);
  }, [shareText]);

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

  const visible = useMemo(
    () => (difficulty ? getVisibleHints(difficulty, wrongGuessCount) : null),
    [difficulty, wrongGuessCount],
  );

  /** Easy: scroll newest hint block into view after a wrong guess unlocks more rows */
  useEffect(() => {
    if (difficulty !== "easy" || wrongGuessCount < 1 || status !== "playing") return;
    const tier = Math.min(wrongGuessCount + 1, 6);
    const body = hintScrollBodyRef.current;
    if (!body) return;
    const id = window.setTimeout(() => {
      const el = body.querySelector(`[data-hint-tier="${tier}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      }
    }, 420);
    return () => window.clearTimeout(id);
  }, [difficulty, wrongGuessCount, status, answer]);

  const newestScrollTier = useMemo(() => {
    if (!difficulty) return null;
    if (difficulty === "easy") {
      if (wrongGuessCount >= 5) return 6;
      if (wrongGuessCount >= 4) return 5;
      if (wrongGuessCount >= 3) return 4;
      if (wrongGuessCount >= 2) return 3;
      if (wrongGuessCount >= 1) return 2;
      return null;
    }
    if (difficulty === "normal" && wrongGuessCount >= 5) return 5;
    if (difficulty === "hard" && wrongGuessCount >= 5) return 7;
    return null;
  }, [difficulty, wrongGuessCount]);

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

  const shouldMaskAnswerInHints = status === "playing";

  const hintMeaningDisplay = useMemo(
    () => (shouldMaskAnswerInHints ? maskAnswerInText(safeWordDisplay.meaning, answer) : safeWordDisplay.meaning),
    [shouldMaskAnswerInHints, safeWordDisplay.meaning, answer],
  );
  const hintDefinitionDisplay = useMemo(
    () =>
      shouldMaskAnswerInHints ? maskAnswerInText(safeWordDisplay.definition, answer) : safeWordDisplay.definition,
    [shouldMaskAnswerInHints, safeWordDisplay.definition, answer],
  );
  const hintExampleLine = useMemo(
    () => formatExampleHintLine(safeWordDisplay.examples[0]),
    [safeWordDisplay.examples],
  );
  const hintExampleDisplay = useMemo(
    () => (shouldMaskAnswerInHints ? maskAnswerInText(hintExampleLine, answer) : hintExampleLine),
    [shouldMaskAnswerInHints, hintExampleLine, answer],
  );

  const speechUnavailable = ttsMountReady && !isSpeechSynthesisSupported();

  const dailyHowToLine = useMemo(() => {
    const base = `${answerLen} ${answerLen === 1 ? "syllable" : "syllables"} · 6 tries · UTC`;
    if (!difficulty) return `Choose a mode to start · ${base}`;
    if (difficulty === "hard") return `Category + tile colors · safety after 5 wrong · ${base}`;
    if (difficulty === "normal") return `Emoji + category · milestones on wrong guesses · ${base}`;
    return `Learner hints · wrong-guess milestones · ${base}`;
  }, [difficulty, answerLen]);

  const practiceHowToLine = useMemo(() => {
    if (!difficulty) return "Practice · choose a mode to start";
    if (difficulty === "hard") return "Practice · minimal hints · streak = daily only";
    if (difficulty === "normal") return "Practice · limited hints · streak = daily only";
    return "Practice · full hints · streak = daily only";
  }, [difficulty]);

  /** One-line tagline for narrow phones */
  const mobileTagline = useMemo(() => {
    if (!difficulty) return "Pick a mode to start";
    if (sessionMode === "practice") return "Guess the practice word";
    return "Daily Korean word game · For K-pop & K-drama fans";
  }, [difficulty, sessionMode]);

  const showTapKeyboardHint =
    hydrated &&
    !welcomeHelpOpen &&
    !pickDifficultyOpen &&
    difficulty !== null &&
    status === "playing" &&
    guesses.length === 0 &&
    !tapHintConsumed;

  return (
    <div
      className="mx-auto flex h-[100dvh] max-h-[100dvh] min-h-0 w-full max-w-[500px] flex-col overflow-hidden px-[max(0.4rem,env(safe-area-inset-left))] pr-[max(0.4rem,env(safe-area-inset-right))] pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-[max(0.35rem,env(safe-area-inset-top))] font-sans text-stone-800 max-[480px]:gap-0 sm:gap-1 sm:px-3"
    >
      <header className="flex shrink-0 flex-col gap-1 max-[480px]:gap-0.5">
        <div className="flex items-center justify-between gap-1.5">
          <button
            type="button"
            onClick={() => setShowStats(true)}
            className="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md px-1.5 text-[11px] font-medium text-stone-700 hover:bg-stone-200/70 hover:text-stone-900 sm:min-h-11 sm:min-w-11 sm:px-2 sm:text-xs"
          >
            Stats
          </button>
          <div className="min-w-0 flex-1 text-center leading-tight">
            <h1 className="truncate font-serif text-[clamp(1.05rem,4.8vw,1.45rem)] tracking-tight text-stone-900 sm:text-xl">
              🇰🇷 Hangle
            </h1>
            <p className="truncate text-[10px] font-medium text-stone-600 max-[360px]:text-[9px] sm:text-[11px]">
              Korean Wordle
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label="How to play and Korean typing help"
              onClick={() => setWelcomeHelpOpen(true)}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-md text-stone-700 hover:bg-stone-200/70 hover:text-stone-900 sm:min-h-11 sm:min-w-11 sm:gap-1 sm:px-2"
            >
              <span className="text-base leading-none" aria-hidden>
                ❓
              </span>
              <span className="hidden text-xs sm:inline">Help</span>
            </button>
            <button
              type="button"
              aria-label="Send feedback"
              onClick={() => setFeedbackOpen(true)}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-md text-stone-700 hover:bg-stone-200/70 hover:text-stone-900 sm:min-h-11 sm:min-w-11 sm:gap-1 sm:px-2"
            >
              <span className="text-base leading-none" aria-hidden>
                💬
              </span>
              <span className="hidden text-xs sm:inline">Feedback</span>
            </button>
            <button
              type="button"
              aria-label="Settings"
              disabled={!difficulty}
              onClick={() => {
                if (!difficulty) return;
                setSettingsOpen(true);
              }}
              className={`flex min-h-10 min-w-10 items-center justify-center rounded-md text-lg leading-none sm:min-h-11 sm:min-w-11 ${
                difficulty
                  ? "text-stone-700 hover:bg-stone-200/70 hover:text-stone-900"
                  : "cursor-not-allowed text-stone-400"
              }`}
            >
              ⚙️
            </button>
            <button
              type="button"
              onClick={() =>
                (status === "won" || status === "lost") &&
                setEndModal({ open: true, kind: status === "won" ? "won" : "lost" })
              }
              className={`flex min-h-10 min-w-[3.25rem] max-w-[4.75rem] shrink-0 items-center justify-center truncate rounded-md px-1 text-[10px] font-medium sm:min-h-11 sm:min-w-[4.25rem] sm:max-w-none sm:px-2 sm:text-xs ${
                status === "won" || status === "lost"
                  ? "text-stone-700 hover:bg-stone-200/70 hover:text-stone-900"
                  : "pointer-events-none invisible"
              }`}
            >
              Summary
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 px-1">
          <span
            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase leading-tight tracking-wide sm:px-2 sm:py-0.5 sm:text-[10px] ${
              sessionMode === "daily"
                ? "border-amber-400/80 bg-amber-50 text-amber-900"
                : "border-stone-400/60 bg-stone-100 text-stone-700"
            }`}
          >
            {sessionMode === "daily" ? "Today's word" : "Practice"}
          </span>
          {difficulty !== null && (
            <button
              type="button"
              aria-label="Change difficulty"
              onClick={() => setSettingsOpen(true)}
              className="shrink-0 rounded-full border border-amber-500/75 bg-[#f5f0e8] px-1.5 py-0.5 text-[9px] font-semibold tabular-nums leading-tight text-stone-900 shadow-sm ring-1 ring-amber-400/35 transition hover:bg-[#efe8dc] active:scale-[0.98] sm:px-2 sm:py-0.5 sm:text-[10px] sm:ring-2"
            >
              {difficultyBadgeLabel(difficulty)}
            </button>
          )}
        </div>

        <p className="text-center text-[10px] tabular-nums leading-tight text-stone-500 max-[480px]:leading-none sm:text-[11px] sm:text-stone-500">
          Today · {playedToday} played
        </p>
      </header>

      {modeToast && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-[max(0.35rem,env(safe-area-inset-top))] z-[60] flex -translate-x-1/2 justify-center px-3 sm:top-[max(0.5rem,env(safe-area-inset-top))]"
        >
          <p className="hint-fade-in rounded-full border border-stone-400/80 bg-[#faf7f0]/98 px-4 py-2 text-center text-[11px] font-semibold text-stone-900 shadow-lg backdrop-blur-[2px] sm:text-xs">
            {modeToast}
          </p>
        </div>
      )}

      {hintToastVisible && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-[max(3.25rem,env(safe-area-inset-top)+2.75rem)] z-[56] flex w-full max-w-md -translate-x-1/2 justify-center px-3"
        >
          <p className="animate-hint-toast rounded-full border border-amber-400/90 bg-amber-50/98 px-4 py-2 text-center text-[12px] font-bold text-amber-950 shadow-lg backdrop-blur-[2px] sm:text-sm">
            💡 New hint unlocked!
          </p>
        </div>
      )}

      <div className="shrink-0 px-0.5 text-center max-[480px]:py-0 sm:py-0.5">
        <p className="truncate text-[12px] font-medium leading-snug text-stone-700 max-[480px]:text-[11px] sm:hidden">
          {mobileTagline}
        </p>
        <div className="hidden space-y-0.5 sm:block">
          <p className="line-clamp-2 text-balance text-[10px] leading-snug text-stone-600 md:text-[11px]">
            {sessionMode === "daily" ? dailyHowToLine : practiceHowToLine}
          </p>
          <p className="text-[10px] leading-snug text-stone-500 md:text-[11px]">
            Learn Korean through a daily puzzle · For K-pop &amp; K-drama fans
          </p>
          <p className="text-[10px] leading-snug text-stone-500 md:text-[11px]">
            For Korean learners (Easy) and Wordle veterans (Hard)
          </p>
        </div>
      </div>

      {showTapKeyboardHint && (
        <p
          className="hint-fade-in shrink-0 px-2 pb-1 text-center text-[13px] font-medium leading-snug text-amber-900/95 max-[480px]:text-[12px] sm:text-[14px]"
          role="status"
        >
          Tap a letter on the keyboard below to start
        </p>
      )}

      {hydrated && status === "playing" && difficulty !== null && visible && (
        <div
          key={`hints-${difficulty}`}
          className="relative z-20 w-full shrink-0 transition-opacity duration-300 ease-out"
        >
          {visible.showFullHintCard && (
            <section
              aria-label="Hints"
              className={`game-hint-card flex shrink-0 flex-col overflow-hidden rounded-xl border border-stone-300/55 bg-[var(--hint-card-bg)] shadow-sm transition-shadow ${
                visible.variant === "easy"
                  ? "game-hint-card--easy max-h-[min(210px,28dvh)] max-[480px]:max-h-[min(185px,26dvh)] sm:max-h-[min(250px,30dvh)]"
                  : "max-h-[min(140px,20dvh)] max-[480px]:max-h-[min(130px,18dvh)] sm:max-h-[min(180px,24dvh)]"
              } ${hintCardPulse ? "hint-card-pulse-once" : ""}`}
            >
              <div className="shrink-0 border-b border-stone-400/25 px-2.5 pb-1 pt-1.5 text-left max-[480px]:px-2 max-[480px]:pb-1 max-[480px]:pt-1.5 sm:px-3.5 sm:pb-1.5 sm:pt-2">
                {visible.showHintDotsRow && visible.hintDotsTotal > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-serif text-[10px] font-semibold tabular-nums text-stone-800 sm:text-[11px]">
                      Hint {visible.hintProgressLabel}
                      <span className="ml-1 font-sans text-[9px] font-medium text-stone-500 sm:text-[10px]">
                        · {visible.dotsTitle}
                      </span>
                    </span>
                    <div className="flex shrink-0 gap-1" aria-hidden>
                      {Array.from({ length: visible.hintDotsTotal }, (_, i) => (
                        <span
                          key={i}
                          className={`h-1.5 w-1.5 rounded-full transition-colors ${
                            i < visible.hintDotsFilled ? "bg-amber-600" : "bg-stone-300/90"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <p className="mt-0.5 text-[9px] leading-snug text-stone-500 sm:text-[10px]">{visible.nextHintSubtitle}</p>

                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {visible.showWordImage && showImage && imageSrc ? (
                    <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-lg border border-stone-300/50 bg-white/80 sm:h-9 sm:w-9">
                      <Image
                        src={imageSrc}
                        alt=""
                        fill
                        sizes="28px"
                        className="object-cover"
                        onError={() => setImgBroken(true)}
                      />
                    </div>
                  ) : visible.showEmoji ? (
                    <span
                      className="flex h-7 w-7 shrink-0 select-none items-center justify-center text-[1.15rem] leading-none sm:h-9 sm:w-9 sm:text-[1.45rem]"
                      style={{
                        fontFamily:
                          "system-ui, 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif",
                      }}
                      aria-hidden
                    >
                      {safeWordDisplay.emoji}
                    </span>
                  ) : null}
                  {visible.showCategoryPill && (
                    <span className="max-w-[min(100%,14rem)] truncate rounded-full border border-stone-400/55 bg-white/40 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-stone-800">
                      {safeWordDisplay.categoryUpper}
                    </span>
                  )}
                </div>

                {visible.showMeaning ? (
                  <div
                    className={`mt-1.5 rounded-md px-0.5 py-0.5 ${freshHintTier === 1 && difficulty === "normal" ? "hint-row-bg-fresh" : ""}`}
                  >
                    <p className="hint-scroll-row-title text-[8px] font-semibold uppercase tracking-wide text-stone-500">
                      Meaning
                    </p>
                    <p className="font-serif text-[12px] leading-snug text-stone-900 sm:text-[13px]">
                      &ldquo;
                      <MaskedPlaceholderText text={hintMeaningDisplay} />
                      &rdquo;
                    </p>
                  </div>
                ) : visible.tryGuessPlaceholder ? (
                  <p className="mt-1.5 text-[11px] font-medium leading-snug text-stone-600">
                    Try to guess the Korean word!
                  </p>
                ) : null}
              </div>

              <div
                ref={hintScrollBodyRef}
                className="hint-card-inner-scroll flex min-h-0 flex-1 flex-col divide-y divide-stone-400/25 overflow-y-auto overscroll-contain px-3 pb-2 pt-1 sm:px-4 sm:pb-2.5"
              >
                {difficulty === "easy" && visible.showDefinition && (
                  <div
                    data-hint-tier="2"
                    className={`hint-fade-in py-1.5 ${scrollHintRowClass(2)}`}
                  >
                    <p className="hint-scroll-row-title text-[8px] font-semibold uppercase tracking-wide text-stone-500">
                      Definition
                    </p>
                    <p
                      className={`text-[11px] leading-snug text-stone-800 sm:text-xs ${freshHintTier === 2 ? "hint-new-text-line" : ""}`}
                    >
                      <MaskedPlaceholderText text={hintDefinitionDisplay} />
                    </p>
                  </div>
                )}

                {difficulty === "easy" && visible.showExample && (
                  <div
                    data-hint-tier="3"
                    className={`hint-fade-in py-1.5 ${scrollHintRowClass(3)}`}
                  >
                    <p className="hint-scroll-row-title text-[8px] font-semibold uppercase tracking-wide text-stone-500">
                      Example
                    </p>
                    <p
                      className={`mt-0.5 text-[11px] leading-snug text-stone-900 sm:text-xs ${freshHintTier === 3 ? "hint-new-text-line" : ""}`}
                    >
                      <MaskedPlaceholderText text={hintExampleDisplay} />
                    </p>
                  </div>
                )}

                {difficulty === "easy" && visible.showJamo && firstWordJamo && (
                  <div
                    data-hint-tier="4"
                    className={`hint-fade-in py-1.5 ${scrollHintRowClass(4)}`}
                  >
                    <p
                      className={`text-[11px] font-semibold leading-snug text-stone-900 sm:text-xs ${freshHintTier === 4 ? "hint-new-text-line" : ""}`}
                    >
                      Starts with{" "}
                      <span className="font-mono text-sm tracking-wide text-stone-950">{firstWordJamo}</span>
                    </p>
                  </div>
                )}

                {visible.showKeyboardHelpRow && (
                  <div
                    data-hint-tier="5"
                    className={`hint-fade-in py-1.5 ${scrollHintRowClass(5)}`}
                  >
                    <p className="hint-scroll-row-title text-[8px] font-semibold uppercase tracking-wide text-stone-500">
                      Keyboard
                    </p>
                    <p
                      className={`text-[11px] leading-snug text-stone-800 sm:text-xs ${freshHintTier === 5 ? "hint-new-text-line" : ""}`}
                    >
                      Jamo used in the answer are highlighted on the keyboard below.
                    </p>
                  </div>
                )}

                {difficulty === "easy" && visible.lastChanceEasy && (
                  <div
                    data-hint-tier="6"
                    className={`hint-fade-in py-1.5 ${scrollHintRowClass(6)}`}
                  >
                    <p className="mb-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-red-700">
                      Last chance · You got this!
                    </p>
                    <p
                      className={`text-center font-serif text-sm font-semibold text-stone-900 sm:text-base ${freshHintTier === 6 ? "hint-new-text-line" : ""}`}
                    >
                      {almostAnswerLine(answer)}
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {visible.showHardCategoryStrip && (
            <section
              aria-label="Hard mode clues"
              className={`game-hint-card flex max-h-[min(110px,16dvh)] shrink-0 flex-col overflow-hidden rounded-xl border border-stone-300/55 bg-[var(--hint-card-bg)] shadow-sm transition-shadow max-[480px]:max-h-[min(100px,14dvh)] sm:max-h-[140px] ${hintCardPulse ? "hint-card-pulse-once" : ""}`}
            >
              <div className="px-2.5 py-2 text-left sm:px-3.5 sm:py-2.5">
                {visible.showHintDotsRow && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-serif text-[10px] font-semibold tabular-nums text-stone-800 sm:text-[11px]">
                      Hint {visible.hintProgressLabel}
                      <span className="ml-1 font-sans text-[9px] font-medium text-stone-500 sm:text-[10px]">
                        · {visible.dotsTitle}
                      </span>
                    </span>
                    <div className="flex shrink-0 gap-1" aria-hidden>
                      {Array.from({ length: visible.hintDotsTotal }, (_, i) => (
                        <span
                          key={i}
                          className={`h-1.5 w-1.5 rounded-full transition-colors ${
                            i < visible.hintDotsFilled ? "bg-amber-600" : "bg-stone-300/90"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <p className="mt-0.5 text-[9px] leading-snug text-stone-500 sm:text-[10px]">{visible.nextHintSubtitle}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="max-w-full truncate rounded-full border border-stone-400/55 bg-white/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-800 sm:text-[11px]">
                    {safeWordDisplay.categoryUpper}
                  </span>
                </div>
                {visible.showHardSafetyBanner && (
                  <div
                    className={`mt-1.5 rounded-lg border border-amber-400/75 bg-amber-50/95 px-2.5 py-1.5 ${freshHintTier === 7 ? "hint-row-bg-fresh" : ""}`}
                  >
                    <p className="text-center text-[10px] font-bold uppercase tracking-wide text-amber-950 sm:text-[11px]">
                      {visible.hardSafetyTitle}
                    </p>
                    <p className="mt-0.5 text-center text-[10px] leading-snug text-amber-950/90 sm:text-[11px]">
                      First consonant/vowel of the answer is highlighted on the keyboard.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden max-[480px]:gap-0 sm:gap-0.5 sm:pt-0.5">
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden py-0">
          <div className="flex w-full max-w-[min(100%,20rem)] shrink-0 flex-col items-center gap-0 px-0.5 sm:max-w-[22rem] sm:gap-0.5">
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

        <div className="game-keyboard-zone mt-0 w-full shrink-0 overflow-x-hidden overflow-y-visible pt-0 max-[480px]:max-h-[min(200px,32dvh)] sm:mt-auto sm:max-h-none sm:overflow-y-auto sm:pt-0.5">
          <HangulKeyboard
            buffer={buffer}
            onBufferChange={setBuffer}
            onEnter={submitGuess}
            disabled={status !== "playing" || !hydrated || !difficulty}
            enterPaused={rowRevealBlock}
            targetSyllables={answerLen}
            highlightAnswer={visible?.highlightFullKeyboard ? answer : ""}
            highlightFirstJamo={
              visible?.highlightFirstJamoOnly && firstWordJamo ? firstWordJamo : ""
            }
          />
        </div>
      </div>

      {showStats && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stats-title"
          onClick={() => setShowStats(false)}
        >
          <div
            className="max-h-[90dvh] w-[min(100%,90vw)] max-w-[90vw] overflow-y-auto rounded-xl border border-stone-200 bg-[#fafaf9] p-4 font-sans shadow-xl sm:max-w-sm sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="stats-title" className="mb-3 font-serif text-xl text-stone-900 sm:mb-4 sm:text-2xl">
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
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="result-title"
          onClick={handleResultClose}
        >
          <div
            className="max-h-[90dvh] w-[min(100%,90vw)] max-w-[90vw] overflow-y-auto rounded-xl border border-stone-200 bg-[#fafaf9] p-4 font-sans shadow-xl sm:max-w-sm sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="result-title" className="font-serif text-[clamp(1.125rem,4vw,1.375rem)] text-stone-900 sm:text-2xl">
              {endModal.kind === "won" ? "🎉 Correct!" : "Better luck next time!"}
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              {endModal.kind === "won"
                ? `You got it! · ${guesses.length}/6`
                : `${guesses.length}/6 tries`}
            </p>

            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-stone-500">
              {endModal.kind === "lost" ? "The word was" : "Answer"}
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
            <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-stone-500">Examples</p>
            <div className="mt-1.5 space-y-1.5">
              {safeWordDisplay.examples.map((ex, i) => {
                const ctx = CONTEXT_EMOJI[ex.context];
                const ttsText = hangulChunksFromText(ex.korean) || ex.korean.trim();
                const slot = (["rex-0", "rex-1", "rex-2"] as const)[i]!;
                const playing = ttsPlaying === slot;
                return (
                  <div
                    key={`${ex.korean}-${i}`}
                    className="rounded-lg border border-stone-200/80 bg-white/75 px-2 py-1.5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <p className="min-w-0 flex-1 text-[12px] font-semibold leading-snug text-stone-900 sm:text-[13px]">
                        <span aria-hidden className="mr-1 select-none">
                          {ctx}
                        </span>
                        {ex.korean}
                      </p>
                      {ttsText ? (
                        <button
                          type="button"
                          onClick={() => speakKoreanWord(slot, ttsText)}
                          aria-label={`Listen: ${ex.korean}`}
                          className={`flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md border border-stone-400/70 bg-white text-[15px] leading-none text-stone-800 shadow-sm transition hover:bg-stone-50 active:scale-95 ${playing ? "border-amber-500/70 bg-amber-50 ring-2 ring-amber-400/55" : ""}`}
                        >
                          <span aria-hidden>🔊</span>
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-0.5 pl-0.5 text-[10px] leading-snug text-stone-600 sm:text-[11px]">{ex.english}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 rounded-xl border-2 border-amber-200/80 bg-[#f5f0e8] p-3 shadow-sm sm:p-4">
              <p className="text-center text-xs font-bold uppercase tracking-wide text-amber-950">
                Share your result
              </p>
              {shareActionNotice && (
                <p
                  className="mt-2 rounded-xl border border-amber-300/60 bg-white/95 px-3 py-2.5 text-center text-[13px] font-semibold leading-snug text-stone-900 shadow-sm sm:text-sm"
                  role="status"
                  aria-live="polite"
                >
                  {shareActionNotice}
                </p>
              )}
              <div className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={handleBragCopy}
                  aria-label="Copy your result to the clipboard to share"
                  className="flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-amber-400/70 bg-amber-50/90 px-1 py-2 text-center text-[11px] font-bold leading-tight text-amber-950 shadow-sm transition hover:bg-amber-100/90 active:scale-[0.99] sm:px-2 sm:text-xs"
                >
                  <span className="text-base leading-none sm:text-lg" aria-hidden>
                    🏆
                  </span>
                  <span>Brag</span>
                </button>
                <button
                  type="button"
                  onClick={handleTweetShare}
                  className="flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-stone-400/80 bg-white px-1 py-2 text-center text-[11px] font-semibold text-stone-900 shadow-sm transition hover:bg-stone-50 active:scale-[0.99] sm:px-2 sm:text-xs"
                >
                  <span aria-hidden>𝕏</span>
                  X
                </button>
                <button
                  type="button"
                  onClick={handleWhatsAppShare}
                  className="flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-stone-400/80 bg-white px-1 py-2 text-center text-[11px] font-semibold text-stone-900 shadow-sm transition hover:bg-stone-50 active:scale-[0.99] sm:px-2 sm:text-xs"
                >
                  <span aria-hidden>💬</span>
                  WhatsApp
                </button>
              </div>
            </div>

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

            {bonusPhrase ? (
              <TodayPhraseBonus
                phrase={bonusPhrase}
                exampleKorean={bonusPhraseExampleKo}
                speechUnavailable={speechUnavailable}
                ttsPlayingPhrase={ttsPlaying === "bonus-phrase"}
                ttsPlayingExample={ttsPlaying === "bonus-example"}
                onSpeakPhrase={() => speakKoreanWord("bonus-phrase", bonusPhrase.phrase)}
                onSpeakExample={() => speakKoreanWord("bonus-example", bonusPhraseExampleKo)}
              />
            ) : null}

            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="mt-4 w-full rounded-xl border border-stone-400/70 bg-[#f5f0e8] py-2.5 text-sm font-medium text-stone-800 shadow-sm transition hover:bg-[#efe8dc] min-h-[44px]"
            >
              💬 Send Feedback
            </button>

            <button
              type="button"
              className="mt-5 w-full rounded-md border border-stone-300 bg-white py-2.5 text-sm hover:bg-stone-50 min-h-[44px]"
              onClick={handleResultClose}
            >
              Close
            </button>
          </div>
        </div>
      )}

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        gameDifficulty={difficulty}
        sessionMode={sessionMode}
        gamesPlayed={stats.gamesPlayed}
      />

      <WelcomeHelpModal
        open={welcomeHelpOpen}
        onClose={closeWelcomeHelp}
        onMarkVisited={markVisitedAndCloseWelcome}
      />

      {pickDifficultyOpen && (
        <div
          className="fixed inset-0 z-50 flex animate-modal-backdrop max-[480px]:items-stretch max-[480px]:p-0 items-end justify-center bg-black/35 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pick-mode-title"
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-stone-300/70 bg-[#f5f0e8] p-4 shadow-2xl animate-modal-panel max-[480px]:max-h-none max-[480px]:min-h-0 max-[480px]:flex-1 max-[480px]:rounded-none max-[480px]:p-4 sm:max-h-[92dvh] sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="pick-mode-title" className="font-serif text-xl font-semibold text-stone-900 sm:text-2xl">
              🇰🇷 Choose your mode
            </h2>
            <p className="mt-1 text-sm text-stone-600">Pick once — we&apos;ll remember on this device.</p>
            <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 sm:mt-5">
              <button
                type="button"
                onClick={() => {
                  saveDifficulty("easy");
                  setDifficulty("easy");
                  flashModeToast("easy");
                  setPickDifficultyOpen(false);
                }}
                className="difficulty-card-hover w-full min-h-[48px] rounded-xl border border-stone-300/80 bg-[#faf7f0] px-4 py-4 text-left shadow-sm sm:min-h-[52px] sm:px-5 sm:py-5"
              >
                <p className="text-sm font-bold text-stone-900">🟢 EASY</p>
                <p className="mt-1 text-[13px] leading-snug text-stone-700 sm:text-sm">
                  All hints revealed. Best for Korean learners.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  saveDifficulty("normal");
                  setDifficulty("normal");
                  flashModeToast("normal");
                  setPickDifficultyOpen(false);
                }}
                className="difficulty-card-hover w-full min-h-[48px] rounded-xl border border-stone-300/80 bg-[#faf7f0] px-4 py-4 text-left shadow-sm sm:min-h-[52px] sm:px-5 sm:py-5"
              >
                <p className="text-sm font-bold text-stone-900">🟡 NORMAL</p>
                <p className="mt-1 text-[13px] leading-snug text-stone-700 sm:text-sm">
                  Some hints. Balanced challenge.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  saveDifficulty("hard");
                  setDifficulty("hard");
                  flashModeToast("hard");
                  setPickDifficultyOpen(false);
                }}
                className="difficulty-card-hover w-full min-h-[48px] rounded-xl border border-stone-300/80 bg-[#faf7f0] px-4 py-4 text-left shadow-sm sm:min-h-[52px] sm:px-5 sm:py-5"
              >
                <p className="text-sm font-bold text-stone-900">🔴 HARD</p>
                <p className="mt-1 text-[13px] leading-snug text-stone-700 sm:text-sm">
                  Minimal hints. For Wordle pros.
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && difficulty !== null && (
        <div
          className="fixed inset-0 z-50 flex animate-modal-backdrop max-[480px]:items-stretch max-[480px]:p-0 items-end justify-center bg-black/35 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-mode-title"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-stone-300/70 bg-[#f5f0e8] p-4 shadow-2xl animate-modal-panel max-[480px]:max-h-none max-[480px]:min-h-0 max-[480px]:flex-1 max-[480px]:rounded-none max-[480px]:p-4 sm:max-h-[92dvh] sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="settings-mode-title" className="font-serif text-xl font-semibold text-stone-900 sm:text-2xl">
              Difficulty
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Playing as <span className="font-semibold">{difficultyBadgeLabel(difficulty)}</span> · tap a mode to
              switch instantly
            </p>
            <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 sm:mt-5">
              {(
                [
                  {
                    id: "easy" as const,
                    title: "🟢 EASY",
                    line: "All hints revealed. Best for Korean learners.",
                  },
                  {
                    id: "normal" as const,
                    title: "🟡 NORMAL",
                    line: "Some hints. Balanced challenge.",
                  },
                  {
                    id: "hard" as const,
                    title: "🔴 HARD",
                    line: "Minimal hints. For Wordle pros.",
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    const next = opt.id;
                    saveDifficulty(next);
                    if (next !== difficulty) flashModeToast(next);
                    setDifficulty(next);
                  }}
                  className={`difficulty-card-hover w-full min-h-[48px] rounded-xl border px-4 py-4 text-left shadow-sm sm:min-h-[52px] sm:px-5 sm:py-5 ${
                    difficulty === opt.id
                      ? "border-amber-500/80 bg-amber-50/50 ring-2 ring-amber-400/40"
                      : "border-stone-300/80 bg-[#faf7f0]"
                  }`}
                >
                  <p className="text-sm font-bold text-stone-900">{opt.title}</p>
                  <p className="mt-1 text-[13px] leading-snug text-stone-700 sm:text-sm">{opt.line}</p>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-5 w-full min-h-[44px] rounded-md border border-stone-400/70 bg-white py-2.5 text-sm font-medium text-stone-800 hover:bg-stone-50 sm:min-h-[48px]"
              onClick={() => setSettingsOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
