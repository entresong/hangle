"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import wordsJson from "@/data/words.json";
import { FeedbackModal } from "@/components/FeedbackModal";
import { WordBoard } from "@/components/WordBoard";
import { AppToast } from "@/components/AppToast";
import { HangulKeyboard } from "@/components/HangulKeyboard";
import {
  entrySyllableCount,
  getUtcDateString,
  isFullHangulWord,
  pickDailyWord,
  pickNextSequentialWord,
} from "@/lib/dailyWord";
import { evaluateGuess } from "@/lib/evaluate";
import {
  addPlayTime,
  bumpVisitCount,
  defaultStats,
  loadGame,
  loadStats,
  mergeStatsAfterGameEnd,
  recordPhraseSeen,
  recordWordLearned,
  saveGame,
  saveStats,
} from "@/lib/storage";
import { getLevelInfo, welcomeMessage } from "@/lib/level";
import {
  ACHIEVEMENTS,
  buildAchievementCtx,
  getCategoryProgress,
  getNewlyUnlocked,
  getUnlockedAchievementIds,
} from "@/lib/achievements";
import {
  allQuestsComplete,
  applyQuestRound,
  loadDailyQuests,
  markQuestHintSpend,
  saveDailyQuests,
  type DailyQuestState,
} from "@/lib/dailyQuests";
import {
  getRankProgress,
  NEXUS_WORD_GOAL,
  nexusProgressPercent,
  nexusWordsLearned,
} from "@/lib/rank";
import { assembleBuffer } from "@/lib/hangulBuffer";
import { copyTextToClipboard } from "@/lib/copyToClipboard";
import {
  countRevealedPaidHints,
  defaultHintReveal,
  hintRoundStorageKey,
  loadHintRevealForRound,
  nextPaidHintInSequence,
  resetHintReveal,
  revealHint,
  type HintRevealState,
  type PaidHintId,
} from "@/lib/hintRevealStorage";
import { refillHeartsFull, loadHearts, spendHeart, type HeartsState } from "@/lib/hearts";
import {
  buildFullSharePayload,
  resolveShareBaseUrl,
  utmContentForResult,
  type ShareUtmContent,
} from "@/lib/shareEconomy";
import { hangleTrack } from "@/lib/hangleTrack";
import {
  cancelSpeech,
  isSpeechSynthesisSupported,
  playPronunciation,
} from "@/lib/pronunciation";
import phrasesJson from "@/data/phrases.json";
import { WelcomeHelpModal } from "@/components/WelcomeHelpModal";
import { HintEconomyPanel } from "@/components/HintEconomyPanel";
import { getNextPhrase } from "@/lib/phraseRotation";
import { validateWordEntries } from "@/lib/validateWords";
import { CONTEXT_EMOJI, getWordExamples } from "@/lib/wordExamples";
import { maskAnswerInExampleText } from "@/lib/maskAnswerInExample";
import { HANGLE_MIGRATION_TOAST_KEY } from "@/components/HangleStorageMigration";
import type { PhraseEntry } from "@/types/phrase";
import type { PersistedGame, TileState, WordEntry } from "@/types/game";

const WORDS = wordsJson as WordEntry[];
const PHRASES = phrasesJson as PhraseEntry[];

const HANGLE_VISITED_KEY = "hangle_visited";
const HANGLE_SESSION_BUMP_KEY = "hangle_session_visited";

/** Delay after color feedback before next-row draft + hint cues */
const ROW_REVEAL_MS = 300;

function formatPlayTimeMs(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

type TtsPlayingSlot = "result-word";

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

function freshGame(puzzleDate: string, currentAnswer: string): PersistedGame {
  return {
    puzzleDate,
    guesses: [],
    evaluations: [],
    status: "playing",
    statsRecorded: false,
    mode: "practice",
    practiceAnswer: currentAnswer,
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

export function Game() {
  const today = useMemo(() => getUtcDateString(), []);
  const dailyEntry = useMemo(() => pickDailyWord(WORDS), []);
  const dailyAnswer = dailyEntry.word;
  const [answer, setAnswer] = useState<string>(dailyAnswer);

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
  const [pulsePaidHint, setPulsePaidHint] = useState<PaidHintId | null>(null);
  const hintsTimersRef = useRef<number[]>([]);
  const hintsUsedThisRoundRef = useRef(0);
  /** Wall-clock start of the current active round (for honest play-time tracking). */
  const roundStartMsRef = useRef<number | null>(null);
  /** Client-mounted — avoids SSR mismatch for speech checks */
  const [ttsMountReady, setTtsMountReady] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState<null | TtsPlayingSlot>(null);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const speechNoticeTimerRef = useRef<number | null>(null);
  /** Same snapshot on server + first client paint; real data applied in hydrate effect */
  const [stats, setStats] = useState(() => defaultStats());
  const [showStats, setShowStats] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);
  const [endModal, setEndModal] = useState<{ open: boolean; kind: "won" | "lost" }>({
    open: false,
    kind: "won",
  });
  const [heartModalOpen, setHeartModalOpen] = useState(false);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [hearts, setHearts] = useState<HeartsState>({ current: 3, lastReset: "" });
  const [hintReveal, setHintReveal] = useState<HintRevealState>(() =>
    defaultHintReveal(hintRoundStorageKey(today, dailyAnswer)),
  );
  /** Generic guidance toast for taps on non-interactive areas (grid cells, category pill) */
  const [infoToast, setInfoToast] = useState<string | null>(null);
  const infoToastTimerRef = useRef<number | null>(null);
  /** Ensures post-migration welcome info toast fires at most once per component mount cycle */
  const migrationWelcomeShownRef = useRef(false);
  /**
   * Visit-count keyed welcome banner shown once per session.
   * Auto-dismissed by two dedicated `useEffect`s below (state-driven) so the
   * dismiss logic is independent from the hydrate effect that *sets* it.
   */
  const [welcomeBanner, setWelcomeBanner] = useState<string | null>(null);
  /** True while the welcome toast is in its exit (fade-out) phase */
  const [welcomeBannerExiting, setWelcomeBannerExiting] = useState(false);
  const [welcomeHelpOpen, setWelcomeHelpOpen] = useState(false);
  const [tapHintConsumed, setTapHintConsumed] = useState(false);
  /** UTC daily quest progress (LoL-style dailies) */
  const [dailyQuestSnapshot, setDailyQuestSnapshot] = useState<DailyQuestState | null>(null);

  /** Safe strings for UI — words.json or merged entries must never crash on missing fields */
  const safeWordDisplay = useMemo(() => {
    const catRaw = answerEntry?.category ?? "WORD";
    const categoryUpper =
      typeof catRaw === "string" ? catRaw.trim().toUpperCase() || "WORD" : "WORD";
    const examples = getWordExamples(answerEntry ?? undefined);
    const tags = Array.isArray(answerEntry?.tags) ? answerEntry!.tags! : [];
    return {
      categoryUpper,
      meaning: typeof answerEntry?.meaning === "string" ? answerEntry.meaning : "",
      definition: typeof answerEntry?.definition === "string" ? answerEntry.definition : "",
      examples,
      emoji: typeof answerEntry?.emoji === "string" ? answerEntry.emoji : "📝",
      tags,
      isKpop: tags.includes("K-POP"),
    };
  }, [answerEntry]);


  const clearHintsTimers = useCallback(() => {
    hintsTimersRef.current.forEach((id) => window.clearTimeout(id));
    hintsTimersRef.current = [];
  }, []);

  useEffect(() => () => clearHintsTimers(), [clearHintsTimers]);

  /** Short guidance toast for taps on non-interactive areas (dead-click prevention) */
  const flashInfoToast = useCallback((msg: string, durationMs = 2400) => {
    setInfoToast(msg);
    if (infoToastTimerRef.current !== null) window.clearTimeout(infoToastTimerRef.current);
    infoToastTimerRef.current = window.setTimeout(() => {
      infoToastTimerRef.current = null;
      setInfoToast(null);
    }, durationMs);
  }, []);

  const dismissInfoToast = useCallback(() => {
    if (infoToastTimerRef.current !== null) {
      window.clearTimeout(infoToastTimerRef.current);
      infoToastTimerRef.current = null;
    }
    setInfoToast(null);
  }, []);

  useEffect(() => {
    return () => {
      if (infoToastTimerRef.current !== null) window.clearTimeout(infoToastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setTtsMountReady(true);
  }, []);

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
    (won: boolean, guessCount: number, bonusPhraseId?: number) => {
      const prevStats = loadStats();
      const start = roundStartMsRef.current;
      const elapsed = start != null ? Date.now() - start : 0;
      roundStartMsRef.current = null;

      let st = mergeStatsAfterGameEnd(prevStats, won, guessCount, "daily");
      st = addPlayTime(st, elapsed);
      if (won) {
        st = recordWordLearned(st, answer);
      }
      if (typeof bonusPhraseId === "number") {
        st = recordPhraseSeen(st, bonusPhraseId);
      }
      saveStats(st);
      setStats(st);

      const beforeQuest = loadDailyQuests();
      const catUpper = (answerEntry.category ?? "").toUpperCase() || "OTHER";
      const nextQuest = applyQuestRound(beforeQuest, {
        won,
        guessCount,
        answerCategory: catUpper,
      });
      saveDailyQuests(nextQuest);
      setDailyQuestSnapshot(nextQuest);

      const justUnlocked = getNewlyUnlocked(prevStats, st, WORDS);
      if (process.env.NODE_ENV === "development" && justUnlocked.length > 0) {
        console.log(
          "[Hangle] Achievements unlocked this round:",
          justUnlocked.map((a) => `${a.emoji} ${a.title}`).join(", "),
        );
      }

      const heartsNow = loadHearts();
      hangleTrack("game_completed", {
        result: won ? "win" : "loss",
        tries: guessCount,
        hints_used: hintsUsedThisRoundRef.current,
        hearts_remaining: heartsNow.current,
      });
    },
    [answer, answerEntry.category],
  );

  useEffect(() => {
    if (!hydrated || status !== "playing") return;
    roundStartMsRef.current = Date.now();
  }, [hydrated, status, answer, today]);

  useEffect(() => {
    setImgBroken(false);
  }, [answer, imageSrc]);

  useEffect(() => {
    cancelSpeech();
    setTtsPlaying(null);
    clearHintsTimers();
    setPulsePaidHint(null);
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

  // Welcome toast auto-dismiss (state-driven, independent from hydrate effect).
  // Phase 1: 2.7s visible → trigger fade-out class
  // Phase 2: 0.3s fade animation → fully unmount the toast
  // Cleanup clears stale timers if banner content changes mid-animation.
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!welcomeBanner) return;
    if (welcomeBannerExiting) return;
    if (process.env.NODE_ENV === "development") {
      console.log("[Welcome] dismiss timer scheduled", { welcomeBanner });
    }
    const fadeTimer = window.setTimeout(() => {
      if (process.env.NODE_ENV === "development") {
        console.log("[Welcome] fade phase fired → setWelcomeBannerExiting(true)");
      }
      setWelcomeBannerExiting(true);
    }, 2700);
    return () => {
      if (process.env.NODE_ENV === "development") {
        console.log("[Welcome] dismiss timer CLEARED (cleanup)");
      }
      window.clearTimeout(fadeTimer);
    };
  }, [welcomeBanner, welcomeBannerExiting]);

  useEffect(() => {
    if (!welcomeBannerExiting) return;
    if (process.env.NODE_ENV === "development") {
      console.log("[Welcome] unmount timer scheduled (300ms)");
    }
    const unmountTimer = window.setTimeout(() => {
      if (process.env.NODE_ENV === "development") {
        console.log("[Welcome] unmount fired → setWelcomeBanner(null)");
      }
      setWelcomeBanner(null);
      setWelcomeBannerExiting(false);
    }, 300);
    return () => window.clearTimeout(unmountTimer);
  }, [welcomeBannerExiting]);

  useEffect(() => {
    let showMigrationWelcome = false;
    try {
      if (window.sessionStorage.getItem(HANGLE_MIGRATION_TOAST_KEY) === "1") {
        window.sessionStorage.removeItem(HANGLE_MIGRATION_TOAST_KEY);
        showMigrationWelcome = true;
      }
    } catch {
      /* ignore */
    }
    if (showMigrationWelcome && !migrationWelcomeShownRef.current) {
      migrationWelcomeShownRef.current = true;
      flashInfoToast(
        "Welcome to the new Hangle! Storage was refreshed for this update (hearts & hints).",
        4000,
      );
    }

    const loaded = loadGame();
    let st = loadStats();

    // Bump visit count once per browser session (sessionStorage gate).
    let sessionAlreadyBumped = false;
    try {
      sessionAlreadyBumped =
        window.sessionStorage.getItem(HANGLE_SESSION_BUMP_KEY) === "true";
    } catch {
      sessionAlreadyBumped = false;
    }
    if (!sessionAlreadyBumped) {
      const visitsBefore = st.visits ?? 0;
      st = bumpVisitCount(st);
      saveStats(st);
      try {
        window.sessionStorage.setItem(HANGLE_SESSION_BUMP_KEY, "true");
      } catch {
        /* ignore */
      }
      const visitCount = st.visits ?? visitsBefore + 1;
      const msg = welcomeMessage(visitCount);
      if (process.env.NODE_ENV === "development") {
        console.log("[Welcome] hydrate effect set banner", { visitCount, msg });
      }
      setWelcomeBanner(msg);
      setWelcomeBannerExiting(false);
    }

    setStats(st);

    setDailyQuestSnapshot(loadDailyQuests());
    setHearts(loadHearts());
    hintsUsedThisRoundRef.current = 0;

    const startFresh = () => {
      saveGame(freshGame(today, dailyAnswer));
      setAnswer(dailyAnswer);
      setGuesses([]);
      setEvaluations([]);
      setStatus("playing");
      setStatsRecorded(false);
      setBuffer([]);
      setHintReveal(defaultHintReveal(hintRoundStorageKey(today, dailyAnswer)));
      setEndModal({ open: false, kind: "won" });
      setHydrated(true);
    };

    if (!loaded || loaded.puzzleDate !== today) {
      startFresh();
      return;
    }

    const storedAnswer =
      loaded.mode === "practice" && typeof loaded.practiceAnswer === "string" && loaded.practiceAnswer.trim()
        ? loaded.practiceAnswer.trim()
        : dailyAnswer;

    setAnswer(storedAnswer);
    setGuesses(loaded.guesses);
    setEvaluations(loaded.evaluations);
    setStatus(loaded.status);
    setStatsRecorded(loaded.statsRecorded === true);
    setBuffer([]);
    const revealLoaded = loadHintRevealForRound(today, storedAnswer);
    setHintReveal(revealLoaded);
    hintsUsedThisRoundRef.current = countRevealedPaidHints(revealLoaded);
    if (loaded.status === "won") {
      setEndModal({ open: true, kind: "won" });
    } else if (loaded.status === "lost") {
      setEndModal({ open: true, kind: "lost" });
    } else {
      setEndModal({ open: false, kind: "won" });
    }

    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flashInfoToast is stable; deps limited to storage keys
  }, [today, dailyAnswer]);

  const shareUrlBase = useMemo(() => resolveShareBaseUrl(), []);

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

    const persist = (
      nextStatus: PersistedGame["status"],
      recorded: boolean,
      bonusPhraseId?: number,
    ) => {
      saveGame({
        puzzleDate: today,
        mode: "practice",
        practiceAnswer: answer,
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
      setStatus("won");
      if (!statsRecorded) applyStatsOnce(true, nextGuesses.length, picked.id);
      setStatsRecorded(true);
      persist("won", true, picked.id);
      setEndModal({ open: true, kind: "won" });
      return;
    }

    if (lostImmediate) {
      const picked = getNextPhrase(PHRASES);
      setStatus("lost");
      if (!statsRecorded) applyStatsOnce(false, nextGuesses.length, picked.id);
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
    setRowRevealBlock(false);
    setInputNotice(null);
    setPulsePaidHint(null);
  }, [clearHintsTimers]);

  const executeNextGameRound = useCallback(() => {
    cancelSpeech();
    setTtsPlaying(null);
    setSpeechNotice(null);
    if (speechNoticeTimerRef.current !== null) {
      window.clearTimeout(speechNoticeTimerRef.current);
      speechNoticeTimerRef.current = null;
    }
    setEndModal((m) => ({ ...m, open: false }));
    clearHintsTimers();
    setRowRevealBlock(false);
    setInputNotice(null);
    setPulsePaidHint(null);
    const nextEntry = pickNextSequentialWord(WORDS, answer);
    const rk = hintRoundStorageKey(today, nextEntry.word);
    setAnswer(nextEntry.word);
    setGuesses([]);
    setEvaluations([]);
    setBuffer([]);
    setStatus("playing");
    setStatsRecorded(false);
    hintsUsedThisRoundRef.current = 0;
    setImgBroken(false);
    const cleared = resetHintReveal(rk);
    setHintReveal(cleared);
    saveGame({ ...freshGame(today, nextEntry.word), statsRecorded: false });
  }, [today, answer, clearHintsTimers]);

  const completeShareRefill = useCallback(
    (
      ctx: "result" | "mid_game" | "header",
      channel: "clipboard" | "twitter" | "facebook" | "whatsapp",
    ) => {
      hangleTrack("share_completed", { context: ctx, channel });
      const next = refillHeartsFull();
      setHearts(next);
      hangleTrack("hearts_refilled", { source: "share" });
      setHeartModalOpen(false);
      setSharePickerOpen(false);
      flashInfoToast(
        channel === "clipboard"
          ? "Link copied! ❤️❤️❤️ Hearts refilled! Thanks for sharing!"
          : "❤️❤️❤️ Hearts refilled! Thanks for sharing!",
      );
    },
    [flashInfoToast],
  );

  const getSharePayloadForContext = useCallback(
    (ctx: "result" | "mid_game" | "header") => {
      const won = status === "won";
      const tries = guesses.length;
      const utm: ShareUtmContent =
        ctx === "header" ? "header" : ctx === "mid_game" ? "mid_game" : utmContentForResult(won, tries);
      if (ctx === "result" && status !== "won" && status !== "lost") return null;
      return buildFullSharePayload({
        won,
        tries,
        answerWord: answer,
        evaluations,
        answerLength: answer.length,
        utmContent: utm,
        baseUrl: shareUrlBase,
      });
    },
    [status, guesses.length, answer, evaluations, shareUrlBase],
  );

  const openSnsShare = useCallback(
    (ctx: "result" | "mid_game" | "header", sns: "twitter" | "facebook" | "whatsapp") => {
      hangleTrack("share_clicked", { context: ctx });
      const payload = getSharePayloadForContext(ctx);
      if (!payload) return;
      const { text, url } = payload;
      const encUrl = encodeURIComponent(url);
      const encText = encodeURIComponent(text);
      let target = "";
      if (sns === "twitter") {
        target = `https://twitter.com/intent/tweet?text=${encText}&url=${encUrl}`;
      } else if (sns === "facebook") {
        target = `https://www.facebook.com/sharer/sharer.php?u=${encUrl}&quote=${encText}`;
      } else {
        target = `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
      }
      window.open(target, "_blank", "noopener,noreferrer");
      completeShareRefill(ctx, sns);
    },
    [getSharePayloadForContext, completeShareRefill],
  );

  const copyShareAndRefill = useCallback(
    async (ctx: "result" | "mid_game" | "header") => {
      hangleTrack("share_clicked", { context: ctx });
      const payload = getSharePayloadForContext(ctx);
      if (!payload) return;
      const ok = await copyTextToClipboard(payload.text);
      if (ok) {
        completeShareRefill(ctx, "clipboard");
      } else {
        flashInfoToast("Could not copy — check permissions and try again.");
      }
    },
    [getSharePayloadForContext, completeShareRefill, flashInfoToast],
  );

  const handleRevealNextHint = useCallback(() => {
    const next = nextPaidHintInSequence(hintReveal);
    if (!next) return;
    if (hearts.current <= 0) return;
    const nextHearts = spendHeart(hearts);
    if (!nextHearts) return;
    setHearts(nextHearts);
    const nextReveal = revealHint(hintReveal, next);
    setHintReveal(nextReveal);
    hintsUsedThisRoundRef.current = countRevealedPaidHints(nextReveal);
    setPulsePaidHint(next);
    window.setTimeout(() => setPulsePaidHint(null), 700);
    const q0 = loadDailyQuests();
    const q1 = markQuestHintSpend(q0);
    saveDailyQuests(q1);
    setDailyQuestSnapshot(q1);
    hangleTrack("hint_used", {
      hint_type: next,
      hearts_remaining: nextHearts.current,
    });
  }, [hearts, hintReveal]);

  const winRate =
    stats.gamesPlayed > 0
      ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
      : 0;
  const avgGuesses =
    stats.gamesWon > 0
      ? (stats.totalGuessesOnWins / stats.gamesWon).toFixed(1)
      : "—";

  const bestWinTry = useMemo(() => {
    const d = stats.guessDistribution ?? [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6; i++) {
      if ((d[i] ?? 0) > 0) return i + 1;
    }
    return null;
  }, [stats.guessDistribution]);

  const wordsLearnedList = useMemo(
    () => stats.wordsLearned ?? [],
    [stats.wordsLearned],
  );
  const rankProgress = useMemo(
    () => getRankProgress(wordsLearnedList.length),
    [wordsLearnedList.length],
  );
  const nexusLearnedDisplay = useMemo(
    () => nexusWordsLearned(wordsLearnedList.length),
    [wordsLearnedList.length],
  );
  const nexusPctDisplay = useMemo(
    () => nexusProgressPercent(wordsLearnedList.length),
    [wordsLearnedList.length],
  );
  const phrasesLearnedCount = (stats.phrasesLearned ?? []).length;
  const levelInfo = useMemo(
    () => getLevelInfo(wordsLearnedList.length),
    [wordsLearnedList.length],
  );

  /** All currently-unlocked achievement IDs (for Stats panel tile state) */
  const unlockedAchievementIds = useMemo(
    () => getUnlockedAchievementIds(stats, WORDS),
    [stats],
  );

  /** Per-category progress rows sorted: in-progress > complete > untouched */
  const categoryProgress = useMemo(
    () => getCategoryProgress(stats, WORDS),
    [stats],
  );

  const dailyQuestForUi = dailyQuestSnapshot ?? loadDailyQuests();

  /** Build context used to draw progress bars on locked achievement tiles */
  const achievementCtx = useMemo(
    () => buildAchievementCtx(stats, WORDS),
    [stats],
  );

  /** K-POP corpus stats: how many K-POP words exist + how many the user has learned */
  const kpopProgress = useMemo(() => {
    const kpopWords = WORDS.filter((w) => Array.isArray(w.tags) && w.tags.includes("K-POP"));
    const total = kpopWords.length;
    const learnedSet = new Set(wordsLearnedList);
    const learned = kpopWords.filter((w) => learnedSet.has(w.word)).length;
    const percent = total > 0 ? Math.round((learned / total) * 100) : 0;
    return { total, learned, percent };
  }, [wordsLearnedList]);

  /** First N tiles of the master word list, marked learned/locked for the grid. */
  const wordsGridPreview = useMemo(() => {
    const TOTAL_TILES = 24;
    const learnedSet = new Set(wordsLearnedList);
    const isKpop = (w: (typeof WORDS)[number]) =>
      Array.isArray(w.tags) && w.tags.includes("K-POP");
    const learnedFirst = WORDS.filter((w) => learnedSet.has(w.word)).slice(0, TOTAL_TILES);
    const remaining = TOTAL_TILES - learnedFirst.length;
    const lockedFill = WORDS.filter((w) => !learnedSet.has(w.word)).slice(0, remaining);
    return [
      ...learnedFirst.map((w) => ({
        word: w.word,
        locked: false,
        emoji: w.emoji,
        kpop: isKpop(w),
      })),
      ...lockedFill.map((w) => ({
        word: w.word,
        locked: true,
        emoji: w.emoji,
        kpop: isKpop(w),
      })),
    ];
  }, [wordsLearnedList]);

  const playedToday =
    stats.utcStatsDate === today ? (stats.gamesFinishedToday ?? 0) : 0;

  /** Non-empty trimmed answer for UI + TTS (avoids `"" || x` collapsing to undefined) */
  const safeAnswerForTts = useMemo(() => {
    if (typeof answer !== "string") return "";
    return answer.trim();
  }, [answer]);

  const examplePanel = useMemo(() => {
    const ex = safeWordDisplay.examples[0];
    if (!ex) return { title: "Example", body: "" };
    const titleRaw = `${CONTEXT_EMOJI[ex.context]} ${ex.korean}`;
    return {
      title: maskAnswerInExampleText(titleRaw, answer),
      body: maskAnswerInExampleText(ex.english ?? "", answer),
    };
  }, [safeWordDisplay.examples, answer]);

  const dailyHowToLine = useMemo(() => {
    const base = `${answerLen} ${answerLen === 1 ? "syllable" : "syllables"} · 6 tries · UTC`;
    return `Category + meaning free · next paid hint costs ❤️ · ${base}`;
  }, [answerLen]);

  const mobileTagline = "Korean word puzzles · hints & hearts";

  const showTapKeyboardHint =
    hydrated &&
    !welcomeHelpOpen &&
    status === "playing" &&
    guesses.length === 0 &&
    !tapHintConsumed;

  const hintsUsedCount = useMemo(() => countRevealedPaidHints(hintReveal), [hintReveal]);

  const nextSequentialHint = useMemo(() => nextPaidHintInSequence(hintReveal), [hintReveal]);

  const renderShareRefillBlock = (
    ctx: "result" | "mid_game" | "header",
    options?: { title?: string | null; variant?: "rose" | "neutral" },
  ) => {
    const explicitNoTitle = options?.title === null;
    const titleDisplay = explicitNoTitle ? null : (options?.title ?? "Share to refill ❤️❤️❤️");
    const variant = options?.variant ?? "rose";
    const wrap =
      variant === "neutral"
        ? "mt-4 space-y-2 rounded-xl border border-stone-300/80 bg-white/95 p-3 shadow-sm"
        : "mt-4 space-y-2 rounded-xl border-2 border-rose-400/70 bg-gradient-to-b from-rose-50 to-white p-3 shadow-md";
    const titleClass =
      variant === "neutral"
        ? "text-center text-sm font-bold text-stone-800"
        : "text-center text-sm font-bold text-rose-900";

    return (
      <div className={wrap}>
        {titleDisplay ? <p className={titleClass}>{titleDisplay}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="min-h-[44px] rounded-lg border border-stone-300 bg-white py-2 text-xs font-bold text-stone-900 shadow-sm transition hover:bg-stone-50"
            onClick={() => openSnsShare(ctx, "twitter")}
          >
            X / Twitter
          </button>
          <button
            type="button"
            className="min-h-[44px] rounded-lg border border-stone-300 bg-white py-2 text-xs font-bold text-stone-900 shadow-sm transition hover:bg-stone-50"
            onClick={() => openSnsShare(ctx, "facebook")}
          >
            Facebook
          </button>
          <button
            type="button"
            className="min-h-[44px] rounded-lg border border-stone-300 bg-white py-2 text-xs font-bold text-stone-900 shadow-sm transition hover:bg-stone-50"
            onClick={() => openSnsShare(ctx, "whatsapp")}
          >
            WhatsApp
          </button>
          <button
            type="button"
            className="min-h-[44px] rounded-lg border border-stone-300 bg-white py-2 text-xs font-bold text-stone-900 shadow-sm transition hover:bg-stone-50"
            onClick={() => void copyShareAndRefill(ctx)}
          >
            Copy text
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      className="mx-auto flex h-[100dvh] max-h-[100dvh] min-h-0 w-full max-w-[500px] flex-col overflow-hidden px-[max(0.4rem,env(safe-area-inset-left))] pr-[max(0.4rem,env(safe-area-inset-right))] pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-[max(0.35rem,env(safe-area-inset-top))] font-sans text-stone-800 max-[480px]:gap-0 sm:gap-1 sm:px-3"
    >
      <header className="flex shrink-0 flex-col gap-0.5 max-[480px]:gap-0">
        <div className="flex w-full min-w-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden px-0.5 sm:gap-1">
          <button
            type="button"
            onClick={() => setShowStats(true)}
            className="flex min-h-9 shrink-0 items-center justify-center rounded-md px-1.5 text-[10px] font-semibold text-stone-800 hover:bg-stone-200/70 sm:min-h-10 sm:px-2 sm:text-xs"
          >
            Stats
          </button>
          <span className="shrink-0 text-stone-400" aria-hidden>
            ·
          </span>
          <button
            type="button"
            onClick={() => setShowStats(true)}
            aria-label={`Rank ${rankProgress.name}, ${nexusLearnedDisplay} of ${NEXUS_WORD_GOAL} words`}
            title="Open statistics"
            className="flex max-w-[5.5rem] min-w-0 shrink-0 items-center gap-0.5 rounded-md px-0.5 py-1 text-[10px] font-bold hover:bg-stone-200/70 sm:max-w-none sm:text-[11px]"
            style={{ color: rankProgress.color }}
          >
            <span aria-hidden className="shrink-0">
              {rankProgress.icon}
            </span>
            <span className="truncate">{rankProgress.name}</span>
          </button>
          <span className="shrink-0 text-stone-400" aria-hidden>
            ·
          </span>
          <div className="min-w-0 flex-1 text-center">
            <h1 className="truncate font-serif text-[0.95rem] font-semibold tracking-tight text-stone-900 sm:text-lg">
              🇰🇷 Hangle
            </h1>
          </div>
          <span className="shrink-0 text-stone-400" aria-hidden>
            ·
          </span>
          <button
            type="button"
            aria-label="How to play and Korean typing help"
            onClick={() => setWelcomeHelpOpen(true)}
            className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-stone-700 hover:bg-stone-200/70 sm:min-h-10 sm:min-w-10"
          >
            <span className="text-base leading-none" aria-hidden>
              ❓
            </span>
          </button>
          <button
            type="button"
            aria-label="Send feedback"
            onClick={() => setFeedbackOpen(true)}
            className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-stone-700 hover:bg-stone-200/70 sm:min-h-10 sm:min-w-10"
          >
            <span className="text-base leading-none" aria-hidden>
              💬
            </span>
          </button>
          <button
            type="button"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
            className="flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-base leading-none text-stone-700 hover:bg-stone-200/70 hover:text-stone-900 sm:min-h-10 sm:min-w-10"
          >
            ⚙️
          </button>
          <button
            type="button"
            aria-label="Round summary"
            onClick={() =>
              (status === "won" || status === "lost") &&
              setEndModal({ open: true, kind: status === "won" ? "won" : "lost" })
            }
            className={`flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-sm sm:min-h-10 sm:min-w-10 ${
              status === "won" || status === "lost"
                ? "text-stone-700 hover:bg-stone-200/70 hover:text-stone-900"
                : "pointer-events-none invisible"
            }`}
          >
            📋
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0 px-1 pb-0.5">
          <span className="shrink-0 cursor-default select-none rounded-full border border-amber-400/80 bg-amber-50 px-1.5 py-0.5 text-[8px] font-medium uppercase leading-tight tracking-wide text-amber-900 sm:px-2 sm:py-0.5 sm:text-[9px]">
            Current word
          </span>
          <span className="shrink-0 text-[8px] tabular-nums text-stone-500 sm:text-[9px]">
            Rounds today · {playedToday}
          </span>
        </div>
      </header>

      {/* Welcome banner — highest priority + boldest styling. Auto-dismisses in 3s. */}
      {welcomeBanner && (
        <AppToast
          variant="welcome"
          toastKey={welcomeBanner}
          z={73}
          exiting={welcomeBannerExiting}
        >
          {welcomeBanner}
        </AppToast>
      )}

      {/* Generic info (dead-click guidance, category clue, etc.) */}
      {infoToast && (
        <AppToast variant="info" toastKey={infoToast} z={72} onDismiss={dismissInfoToast}>
          {infoToast}
        </AppToast>
      )}

      <div className="shrink-0 px-0.5 text-center max-[480px]:py-0 sm:py-0.5">
        <p className="truncate text-[12px] font-medium leading-snug text-stone-700 max-[480px]:text-[11px] sm:hidden">
          {mobileTagline}
        </p>
        <div className="hidden space-y-0.5 sm:block">
          <p className="line-clamp-2 text-balance text-[10px] leading-snug text-stone-600 md:text-[11px]">
            {dailyHowToLine}
          </p>
          <p className="text-[10px] leading-snug text-stone-500 md:text-[11px]">
            Learn Korean through word puzzles · For K-pop &amp; K-drama fans
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

      {hydrated && status === "playing" && (
        <div className="relative z-20 flex w-full shrink-0 flex-col items-center gap-2 px-0.5 pb-1">
          <HintEconomyPanel
            categoryUpper={safeWordDisplay.categoryUpper}
            emoji={safeWordDisplay.emoji}
            meaning={safeWordDisplay.meaning}
            definition={safeWordDisplay.definition}
            exampleTitle={examplePanel.title}
            exampleBody={examplePanel.body}
            imageSrc={imageSrc}
            imgBroken={imgBroken}
            onImgError={() => setImgBroken(true)}
            reveal={hintReveal}
            pulseHint={pulsePaidHint}
            pronunciationSlot={
              <button
                type="button"
                onClick={() => safeAnswerForTts && speakKoreanWord("result-word", safeAnswerForTts)}
                disabled={!hintReveal.pronunciation || !safeAnswerForTts}
                className={`rounded-lg border border-stone-300/80 bg-white px-2 py-1 text-[11px] font-semibold text-stone-800 shadow-sm transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-40 ${ttsPlaying === "result-word" ? "ring-2 ring-amber-400/65" : ""}`}
              >
                🔊 Listen
              </button>
            }
          />
          <button
            type="button"
            aria-label={hearts.current <= 0 ? "Out of hearts — tap to refill" : "Hearts — tap to refill"}
            onClick={() => setHeartModalOpen(true)}
            className={`flex w-full max-w-[min(100%,22rem)] flex-col items-center justify-center rounded-xl border-2 px-3 py-2.5 text-center shadow-sm transition hover:bg-stone-50 active:scale-[0.99] ${
              hearts.current <= 0
                ? "border-rose-400/85 bg-rose-50/95"
                : "border-rose-200/90 bg-rose-50/90"
            }`}
          >
            {hearts.current > 0 ? (
              <p className="flex flex-wrap items-center justify-center gap-1.5 text-[15px] font-bold text-stone-900 sm:text-base">
                <span>Hearts:</span>
                <span className="text-2xl leading-none tracking-tight sm:text-[1.75rem]" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span key={i}>{i < hearts.current ? "❤️" : "🤍"}</span>
                  ))}
                </span>
              </p>
            ) : (
              <p className="text-[13px] font-semibold leading-snug text-rose-900 sm:text-[14px]">
                <span className="text-xl leading-none sm:text-2xl" aria-hidden>
                  🤍🤍🤍
                </span>{" "}
                Out of hearts · Tap to refill
              </p>
            )}
          </button>
          {nextSequentialHint !== null ? (
            <div className="flex w-full shrink-0 justify-center">
              <button
                type="button"
                disabled={hearts.current <= 0}
                aria-disabled={hearts.current <= 0}
                onClick={handleRevealNextHint}
                className={`flex w-full max-w-[min(100%,22rem)] min-h-[48px] flex-col items-center justify-center rounded-xl border-2 px-3 py-2 text-center shadow-md transition active:scale-[0.99] ${
                  hearts.current <= 0
                    ? "cursor-not-allowed border-stone-300/80 bg-stone-200/80 text-stone-500 opacity-90"
                    : "border-amber-500/90 bg-amber-500 text-white hover:bg-amber-600"
                }`}
              >
                <span className="text-[15px] font-bold leading-tight">
                  {hearts.current <= 0 ? "Out of hearts" : "Get next hint"}
                </span>
                {hearts.current > 0 ? (
                  <span className="mt-0.5 text-xs font-semibold text-amber-50">❤️ 1</span>
                ) : null}
              </button>
            </div>
          ) : null}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden max-[480px]:gap-0 sm:gap-0.5 sm:pt-0.5">
        <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden py-0.5">
          <div className="flex w-full min-h-0 max-w-[min(100%,22rem)] flex-1 flex-col items-center justify-center gap-0.5 px-0.5 sm:max-w-[22rem] sm:gap-1">
            {inputNotice && (
              <p
                key={inputNotice}
                role="alert"
                className="animate-dict-notice max-[667px]:text-[11px] shrink-0 text-center text-[12px] font-semibold text-red-700"
              >
                {inputNotice}
              </p>
            )}
            <div
              className="flex w-full shrink-0 flex-col items-center justify-center"
              onClick={() => {
                if (status !== "playing" || !hydrated || rowRevealBlock) {
                  return;
                }
                flashInfoToast("Tap a letter on the keyboard below ↓");
                if (process.env.NODE_ENV === "development") {
                  console.log("[Game] dead-click guard · board tapped → keyboard hint shown");
                }
              }}
            >
              <WordBoard
                guesses={guesses}
                evaluations={evaluations}
                currentRow={currentRow}
                buffer={buffer}
                shakeRow={shakeRow}
                draftFlashRed={draftFlashRed}
                suppressDraft={rowRevealBlock}
                status={status}
                answerLength={answerLen}
                showActiveRow={status === "playing"}
              />
            </div>
            {status === "playing" && guesses.length < 6 && (
              <p
                className={`shrink-0 text-center text-[11px] font-medium tabular-nums max-[480px]:text-[10px] ${
                  guesses.length === 5 ? "font-semibold text-red-600" : "text-stone-500"
                }`}
              >
                {guesses.length === 5
                  ? "Last try!"
                  : `${6 - guesses.length} ${6 - guesses.length === 1 ? "try" : "tries"} left`}
              </p>
            )}
          </div>
        </div>

        {speechNotice ? (
          <p
            className="mx-auto w-full max-w-[min(100%,22rem)] shrink-0 px-1 pb-1 text-center text-[11px] font-medium text-amber-900/90"
            role="status"
          >
            {speechNotice}
          </p>
        ) : null}

        <div className="game-keyboard-zone mt-0 w-full shrink-0 overflow-x-hidden overflow-y-visible pt-0 max-[480px]:max-h-[min(180px,30dvh)] sm:mt-auto sm:max-h-none sm:overflow-y-auto sm:pt-0.5">
          <HangulKeyboard
            buffer={buffer}
            onBufferChange={setBuffer}
            onEnter={submitGuess}
            disabled={status !== "playing" || !hydrated}
            enterPaused={rowRevealBlock}
            targetSyllables={answerLen}
            highlightAnswer=""
            highlightFirstJamo=""
            showFirstKeyHint={
              hydrated &&
              status === "playing" &&
              guesses.length === 0 &&
              (stats.visits ?? 0) <= 1 &&
              (stats.wordsLearned?.length ?? 0) === 0
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
            <h2 id="stats-title" className="mb-1 font-serif text-xl text-stone-900 sm:mb-2 sm:text-2xl">
              Statistics
            </h2>
            <p className="mb-3 text-center text-[10px] leading-snug text-stone-500 sm:mb-4 sm:text-[11px]">
              Korean Master (Nexus) bar and bonus quests (UTC) moved here from the home screen — see{" "}
              <span className="font-semibold text-stone-600">🏆 Your Stats</span> below.
            </p>

            <div className="mb-5 rounded-xl border border-stone-300/70 bg-gradient-to-b from-white to-stone-50/90 p-3 shadow-sm sm:p-4">
              <p className="text-center text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500 sm:text-[11px]">
                🏆 Your Stats
              </p>
              <div className="mt-2 flex items-center justify-center gap-2 text-sm font-semibold text-stone-900">
                <span aria-hidden className="text-lg" style={{ color: rankProgress.color }}>
                  {rankProgress.icon}
                </span>
                <span style={{ color: rankProgress.color }}>{rankProgress.name}</span>
                {rankProgress.nextMin !== null && (
                  <span className="text-xs font-normal text-stone-600">
                    ({rankProgress.wordsToNext} to {getRankProgress(rankProgress.nextMin).name}!)
                  </span>
                )}
              </div>
              {rankProgress.nextMin !== null && (
                <>
                  <div
                    className="mt-2 h-2 w-full overflow-hidden rounded-full bg-stone-200"
                    role="progressbar"
                    aria-valuenow={rankProgress.progressInTierPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Progress toward next rank"
                  >
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${rankProgress.progressInTierPercent}%`,
                        backgroundColor: rankProgress.color,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-center text-[10px] text-stone-500">
                    {rankProgress.progressInTierPercent}% toward next rank
                  </p>
                </>
              )}

              <p className="mt-4 text-[10px] font-bold uppercase tracking-wide text-stone-500">📊 Games</p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-stone-700 sm:text-sm">
                <li className="flex justify-between gap-2 tabular-nums">
                  <span>Total</span>
                  <span className="font-semibold">{stats.gamesPlayed}</span>
                </li>
                <li className="flex justify-between gap-2 tabular-nums">
                  <span>Won</span>
                  <span className="font-semibold">
                    {stats.gamesWon}{" "}
                    {stats.gamesPlayed > 0
                      ? `(${Math.round((stats.gamesWon / stats.gamesPlayed) * 100)}%)`
                      : ""}
                  </span>
                </li>
                <li className="flex justify-between gap-2 tabular-nums">
                  <span>Avg tries (wins)</span>
                  <span className="font-semibold">{avgGuesses}</span>
                </li>
                <li className="flex justify-between gap-2 tabular-nums">
                  <span>Best</span>
                  <span className="font-semibold">
                    {bestWinTry !== null ? `${bestWinTry} ${bestWinTry === 1 ? "try" : "tries"} ⚡` : "—"}
                  </span>
                </li>
              </ul>

              <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-stone-500">🔥 Streak</p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-stone-700 sm:text-sm">
                <li className="flex justify-between gap-2 tabular-nums">
                  <span>Current</span>
                  <span className="font-semibold">{stats.currentStreak} wins</span>
                </li>
                <li className="flex justify-between gap-2 tabular-nums">
                  <span>Best</span>
                  <span className="font-semibold">{stats.maxStreak} wins</span>
                </li>
              </ul>

              <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-stone-500">📚 Words (Nexus)</p>
              <div className="mt-1 flex justify-between text-[11px] font-semibold tabular-nums text-stone-800 sm:text-sm">
                <span>
                  {nexusLearnedDisplay}/{NEXUS_WORD_GOAL}
                </span>
                <span>{nexusPctDisplay}%</span>
              </div>
              <div
                className="mt-1 h-2 w-full overflow-hidden rounded-full bg-stone-200"
                role="progressbar"
                aria-valuenow={nexusPctDisplay}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-rose-500 transition-all"
                  style={{ width: `${nexusPctDisplay}%` }}
                />
              </div>

              <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-stone-500">
                🏅 Category progress
              </p>
              <ul className="mt-1 space-y-1 text-[10px] text-stone-700 sm:text-[11px]">
                {categoryProgress.slice(0, 6).map((c) => (
                  <li key={c.category} className="flex justify-between gap-2 tabular-nums">
                    <span>
                      {c.category === "FOOD"
                        ? "🍔"
                        : c.category === "EMOTION"
                          ? "❤️"
                          : c.category === "NATURE"
                            ? "🌸"
                            : "📁"}{" "}
                      {c.category}
                    </span>
                    <span className="font-medium">
                      {c.learned}/{c.total}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-3 text-center text-[10px] text-stone-500">
                ⏱️ Total time: {formatPlayTimeMs(stats.totalPlayTimeMs ?? 0)}
              </p>
              <p className="mt-0.5 text-center text-[9px] leading-snug text-stone-400">
                Estimated from finished rounds (capped per round).
              </p>

              <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-stone-500">
                🎯 Bonus quests (UTC)
              </p>
              <ul className="mt-1 space-y-0.5 text-[10px] text-stone-700">
                <li className="flex items-center gap-1.5">
                  <span aria-hidden>{dailyQuestForUi.gamesFinished >= 3 ? "⭐" : "□"}</span>
                  Play 3 games ({Math.min(3, dailyQuestForUi.gamesFinished)}/3)
                </li>
                <li className="flex items-center gap-1.5">
                  <span aria-hidden>{dailyQuestForUi.wonInThreeOrFewer ? "⭐" : "□"}</span>
                  Win in 3 tries or less
                </li>
                <li className="flex items-center gap-1.5">
                  <span aria-hidden>{dailyQuestForUi.usedPaidHintToday ? "⭐" : "□"}</span>
                  Use a paid hint (❤️)
                </li>
                <li className="flex items-center gap-1.5">
                  <span aria-hidden>{dailyQuestForUi.wonFoodToday ? "⭐" : "□"}</span>
                  Solve a FOOD word
                </li>
              </ul>
              {allQuestsComplete(dailyQuestForUi) && (
                <p className="mt-2 text-center text-[10px] font-bold text-amber-800">
                  Quest master! ⭐⭐⭐
                </p>
              )}

              <button
                type="button"
                className="mt-3 w-full rounded-lg border border-stone-300 bg-white py-2 text-xs font-semibold text-stone-800 shadow-sm transition hover:bg-stone-50"
                onClick={() => {
                  document.getElementById("stats-word-collection")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                }}
              >
                Word Collection →
              </button>
            </div>

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
            <div className="mb-5 rounded-xl border border-amber-300/60 bg-amber-50/50 p-3 shadow-sm sm:p-4">
              <p className="cursor-default text-center text-[10px] font-bold uppercase tracking-[0.14em] text-amber-900/85 sm:text-[11px]">
                🎓 Your Korean Journey
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:gap-3">
                <div className="cursor-default">
                  <p className="font-serif text-xl font-semibold text-stone-900 tabular-nums sm:text-2xl">
                    {wordsLearnedList.length}
                  </p>
                  <p className="text-[9px] uppercase tracking-wide text-stone-500 sm:text-[10px]">
                    Words
                  </p>
                </div>
                <div className="cursor-default">
                  <p className="font-serif text-xl font-semibold text-stone-900 tabular-nums sm:text-2xl">
                    {phrasesLearnedCount}
                  </p>
                  <p className="text-[9px] uppercase tracking-wide text-stone-500 sm:text-[10px]">
                    Phrases
                  </p>
                </div>
                <div className="cursor-default">
                  <p className="font-serif text-xl font-semibold text-stone-900 tabular-nums sm:text-2xl">
                    {stats.visits ?? 0}
                  </p>
                  <p className="text-[9px] uppercase tracking-wide text-stone-500 sm:text-[10px]">
                    Visits
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="cursor-default text-[13px] font-semibold text-stone-900 sm:text-sm">
                  <span aria-hidden className="mr-1">
                    {levelInfo.emoji}
                  </span>
                  Level: {levelInfo.current}
                </p>
                <p className="cursor-default text-[10px] text-stone-600 sm:text-[11px]">
                  {levelInfo.nextLevel
                    ? `${levelInfo.wordsToNext} more to ${levelInfo.nextLevel}`
                    : "Max level — 잘했어!"}
                </p>
              </div>
              <div
                className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-stone-200/80"
                role="progressbar"
                aria-valuenow={levelInfo.progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Progress to ${levelInfo.nextLevel ?? "max level"}`}
              >
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-700 ease-out"
                  style={{ width: `${levelInfo.progressPercent}%` }}
                />
              </div>

              {/* K-POP word collection progress */}
              <div className="mt-3 cursor-default rounded-lg border border-pink-300/55 bg-pink-50/70 px-2.5 py-1.5">
                <div className="flex items-baseline justify-between text-[10px] text-pink-900 sm:text-[11px]">
                  <span className="font-bold uppercase tracking-wide">
                    🎵 K-pop words
                  </span>
                  <span className="font-mono tabular-nums text-pink-700">
                    {kpopProgress.learned}/{kpopProgress.total} · {kpopProgress.percent}%
                  </span>
                </div>
                <div
                  className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-pink-200/70"
                  role="progressbar"
                  aria-valuenow={kpopProgress.percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="K-pop word collection progress"
                >
                  <div
                    className="h-full rounded-full bg-pink-500 transition-all duration-700 ease-out"
                    style={{ width: `${kpopProgress.percent}%` }}
                  />
                </div>
                <p className="mt-1 cursor-default text-[9px] leading-snug text-pink-800/80">
                  Words often heard in Korean pop music
                </p>
              </div>

              {/* Achievement badge grid (15 tiles, unlocked vs locked) */}
              <p className="mt-4 cursor-default text-[9px] font-bold uppercase tracking-wide text-stone-500 sm:text-[10px]">
                🏆 Achievements · {unlockedAchievementIds.size}/{ACHIEVEMENTS.length}
              </p>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {ACHIEVEMENTS.map((a) => {
                  const unlocked = unlockedAchievementIds.has(a.id);
                  const prog = a.progress ? a.progress(achievementCtx) : null;
                  const pct = prog
                    ? Math.min(100, Math.round((prog.value / Math.max(1, prog.target)) * 100))
                    : 0;
                  return (
                    <div
                      key={a.id}
                      title={`${a.title} — ${a.description}`}
                      className={`flex cursor-default select-none flex-col items-center justify-center rounded-lg border p-1.5 text-center transition ${
                        unlocked
                          ? "border-amber-400/70 bg-amber-50/80 shadow-sm"
                          : "border-stone-200/80 bg-stone-100/60 opacity-65"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`text-xl leading-none ${unlocked ? "" : "grayscale"}`}
                        style={{
                          fontFamily:
                            "system-ui, 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif",
                        }}
                      >
                        {a.emoji}
                      </span>
                      <span
                        className={`mt-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide ${unlocked ? "text-stone-900" : "text-stone-500"}`}
                      >
                        {a.title}
                      </span>
                      {!unlocked && prog && (
                        <span className="mt-0.5 font-mono text-[8px] tabular-nums text-stone-500">
                          {prog.value}/{prog.target}
                        </span>
                      )}
                      {!unlocked && prog && (
                        <div className="mt-0.5 h-0.5 w-full overflow-hidden rounded-full bg-stone-200">
                          <div
                            className="h-full rounded-full bg-amber-400 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Full per-category progress with bars */}
              <p className="mt-4 cursor-default text-[9px] font-bold uppercase tracking-wide text-stone-500 sm:text-[10px]">
                📚 By category
              </p>
              <div className="mt-1.5 space-y-1.5">
                {categoryProgress.map((c) => (
                  <div key={c.category} className="cursor-default">
                    <div className="flex items-baseline justify-between text-[10px] text-stone-700 sm:text-[11px]">
                      <span className="font-semibold uppercase tracking-wide">
                        {c.category}
                      </span>
                      <span className="font-mono tabular-nums text-stone-500">
                        {c.learned}/{c.total} · {c.percent}%
                      </span>
                    </div>
                    <div
                      className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-200/80"
                      role="progressbar"
                      aria-valuenow={c.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${c.category} progress`}
                    >
                      <div
                        className={`h-full rounded-full transition-all duration-700 ease-out ${c.percent >= 100 ? "bg-emerald-500" : "bg-amber-500"}`}
                        style={{ width: `${c.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-4 cursor-default text-[9px] font-bold uppercase tracking-wide text-stone-500 sm:text-[10px]" id="stats-word-collection">
                Word collection · {wordsLearnedList.length}/{WORDS.length}
              </p>
              <div className="mt-1.5 grid grid-cols-6 gap-1 sm:gap-1.5">
                {wordsGridPreview.map((tile, i) => (
                  <div
                    key={`${tile.word}-${i}`}
                    title={
                      tile.locked
                        ? "Locked — solve to reveal"
                        : `${tile.word}${tile.kpop ? " · K-pop" : ""}`
                    }
                    className={`relative flex aspect-square select-none items-center justify-center rounded-md border text-[10px] font-semibold leading-tight sm:text-[11px] ${
                      tile.locked
                        ? "border-stone-200/80 bg-stone-100/70 text-stone-300"
                        : tile.kpop
                          ? "border-pink-400/70 bg-pink-50/80 text-stone-900"
                          : "border-emerald-400/70 bg-emerald-50/80 text-stone-900"
                    }`}
                  >
                    {tile.locked ? "•" : tile.word}
                    {!tile.locked && tile.kpop && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -right-0.5 -top-1 select-none text-[8px] leading-none drop-shadow-sm"
                        style={{
                          fontFamily:
                            "system-ui, 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif",
                        }}
                      >
                        🎵
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {wordsLearnedList.length < WORDS.length && (
                <p className="mt-2 cursor-default text-center text-[10px] text-stone-500">
                  {WORDS.length - wordsLearnedList.length} more words to discover
                </p>
              )}
              <p className="mt-3 cursor-default text-center text-[10px] leading-snug text-amber-900/85 sm:text-[11px]">
                💎 {WORDS.length}+ Korean words · 💬 Bonus phrases every round
              </p>
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
            className="w-[min(100%,90vw)] max-w-[90vw] rounded-xl border border-stone-200 bg-[#fafaf9] p-4 font-sans shadow-xl sm:max-w-sm sm:p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="result-title" className="font-serif text-xl text-stone-900 sm:text-2xl">
              {endModal.kind === "won" ? "Solved!" : "Better luck next time!"}
            </h2>

            <div className="mt-4 rounded-xl border border-stone-200 bg-white px-3 py-3 shadow-sm">
              <p className="text-center text-[10px] font-bold uppercase tracking-wide text-stone-500">Answer</p>
              {safeAnswerForTts ? (
                <>
                  <p className="mt-1 text-center font-serif text-3xl font-semibold text-stone-900">{answer}</p>
                  {safeWordDisplay.meaning ? (
                    <p className="mt-2 text-center text-sm leading-snug text-stone-700">{safeWordDisplay.meaning}</p>
                  ) : null}
                </>
              ) : (
                <p className="mt-1 text-center text-sm text-stone-500">Word unavailable.</p>
              )}
            </div>

            <ul className="mt-3 space-y-2 text-sm text-stone-800">
              <li>
                <span className="font-semibold">Tries:</span> {guesses.length}/6
              </li>
              <li className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">Hints used:</span>
                {hintsUsedCount > 0 ? (
                  <>
                    <span aria-hidden className="text-base leading-none">
                      {Array.from({ length: hintsUsedCount }, () => "❤️").join("")}
                    </span>
                    <span className="text-stone-600">× {hintsUsedCount}</span>
                  </>
                ) : (
                  <span className="text-stone-500">none</span>
                )}
              </li>
            </ul>

            <div className="mt-3 rounded-lg border border-stone-200 bg-white/90 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">Rank progress</p>
              <p className="mt-1 text-sm font-semibold" style={{ color: rankProgress.color }}>
                <span aria-hidden>{rankProgress.icon}</span> {rankProgress.name} ·{" "}
                {rankProgress.progressInTierPercent}/100 in tier
              </p>
              <div
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-stone-200"
                role="progressbar"
                aria-valuenow={rankProgress.progressInTierPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Rank tier progress"
              >
                <div
                  className="h-full rounded-full bg-rose-500 transition-all"
                  style={{ width: `${rankProgress.progressInTierPercent}%` }}
                />
              </div>
            </div>

            {renderShareRefillBlock("result", { title: "Share your result", variant: "neutral" })}

            <button
              type="button"
              onClick={() => executeNextGameRound()}
              className="mt-4 flex w-full min-h-[52px] items-center justify-center rounded-xl bg-amber-500 px-4 py-3 text-base font-bold text-white shadow-md transition hover:bg-amber-600 active:scale-[0.99]"
            >
              Next game
            </button>
            <button
              type="button"
              onClick={handleResultClose}
              className="mt-2 w-full py-2 text-xs text-stone-500 underline underline-offset-2 hover:text-stone-700"
            >
              Close
            </button>

          </div>
        </div>
      )}

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        gamesPlayed={stats.gamesPlayed}
      />

      <WelcomeHelpModal
        open={welcomeHelpOpen}
        onClose={closeWelcomeHelp}
        onMarkVisited={markVisitedAndCloseWelcome}
      />

      {sharePickerOpen && (
        <div
          className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-picker-title"
          onClick={() => setSharePickerOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-stone-300/70 bg-[#faf7f0] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="share-picker-title" className="font-serif text-lg font-semibold text-stone-900">
              Share to refill hearts
            </h2>
            {renderShareRefillBlock("mid_game")}
            <button
              type="button"
              className="mt-3 w-full rounded-lg py-2 text-sm font-medium text-stone-600 hover:bg-stone-200/50"
              onClick={() => setSharePickerOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {heartModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="heart-help-title"
          onClick={() => setHeartModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-stone-300/70 bg-[#faf7f0] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="heart-help-title" className="font-serif text-lg font-semibold text-stone-900">
              Hearts
            </h2>
            {hearts.current <= 0 ? (
              <>
                <p className="mt-3 text-center text-lg font-bold text-rose-900">Out of hearts</p>
                <p className="mt-2 text-center text-sm text-stone-700">
                  Share to refill: <span aria-hidden>❤️❤️❤️</span>
                </p>
              </>
            ) : (
              <>
                <p className="mt-3 text-center text-sm font-semibold text-stone-900">
                  Hearts: {hearts.current}/3
                </p>
                <p className="mt-1 text-center text-sm text-stone-700">Hints in game cost 1 ❤️ each.</p>
                <p className="mt-1 text-center text-sm text-stone-700">Share to refill to 3 ❤️</p>
              </>
            )}
            {renderShareRefillBlock("header", { title: null, variant: "neutral" })}
            <button
              type="button"
              className="mt-2 w-full rounded-lg py-2 text-sm font-medium text-stone-600 hover:bg-stone-200/50"
              onClick={() => setHeartModalOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex animate-modal-backdrop max-[480px]:items-stretch max-[480px]:p-0 items-end justify-center bg-black/35 p-3 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-stone-300/70 bg-[#f5f0e8] p-4 shadow-2xl animate-modal-panel max-[480px]:max-h-none max-[480px]:min-h-0 max-[480px]:flex-1 max-[480px]:rounded-none max-[480px]:p-4 sm:max-h-[92dvh] sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="settings-title" className="font-serif text-xl font-semibold text-stone-900 sm:text-2xl">
              Settings
            </h2>
            <p className="mt-2 text-sm text-stone-600">
              Continuous Korean word rounds. Paid hints use hearts (❤️); sharing refills hearts anytime. Local
              midnight also resets hearts to 3.
            </p>
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
