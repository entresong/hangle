"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Hangul from "hangul-js";
import wordsJson from "@/data/words.json";
import { FeedbackModal } from "@/components/FeedbackModal";
import { WordBoard } from "@/components/WordBoard";
import { AppToast } from "@/components/AppToast";
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
  addPlayTime,
  appendPracticeClearedWord,
  bumpVisitCount,
  defaultStats,
  loadGame,
  loadStats,
  mergeStatsAfterGameEnd,
  recordPhraseSeen,
  recordWordLearned,
  resetPracticeSolvedPool,
  saveGame,
  saveStats,
} from "@/lib/storage";
import { getLevelInfo, welcomeMessage } from "@/lib/level";
import {
  ACHIEVEMENTS,
  buildAchievementCtx,
  getAttemptGrade,
  getCategoryProgress,
  getNewlyUnlocked,
  getUnlockedAchievementIds,
  type AchievementDef,
} from "@/lib/achievements";
import { getNewlyCompletedCategories, isNewlyKpopTagCorpusMaster } from "@/lib/categoryMasters";
import {
  allQuestsComplete,
  applyQuestRound,
  loadDailyQuests,
  saveDailyQuests,
  type DailyQuestState,
} from "@/lib/dailyQuests";
import {
  getRankProgress,
  NEXUS_WORD_GOAL,
  nexusProgressPercent,
  nexusWordsLearned,
} from "@/lib/rank";
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
const HANGLE_SESSION_BUMP_KEY = "hangle_session_visited";

/** Delay after color feedback before next-row draft + hint cues */
const ROW_REVEAL_MS = 300;

/** How long the “Brag” clipboard toast stays visible (read time on mobile). */
const BRAG_TOAST_MS = 3800;

function formatPlayTimeMs(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

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
  /** Wall-clock start of the current active round (for honest play-time tracking). */
  const roundStartMsRef = useRef<number | null>(null);
  /** Snapshot for result modal (distinct new word this round, etc.) */
  const roundGamificationRef = useRef<{
    newDistinctWord: boolean;
    guessCount: number;
    wonIn3OrLess: boolean;
  }>({
    newDistinctWord: false,
    guessCount: 0,
    wonIn3OrLess: false,
  });
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
  /** Generic guidance toast for taps on non-interactive areas (grid cells, category pill) */
  const [infoToast, setInfoToast] = useState<string | null>(null);
  const infoToastTimerRef = useRef<number | null>(null);
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
  const [wordsLearnedBump, setWordsLearnedBump] = useState(false);
  /** Achievements unlocked during the just-finished round — drives result-modal celebration */
  const [newlyUnlockedAchievements, setNewlyUnlockedAchievements] = useState<AchievementDef[]>(
    [],
  );
  /** UTC daily quest progress (LoL-style dailies) */
  const [dailyQuestSnapshot, setDailyQuestSnapshot] = useState<DailyQuestState | null>(null);
  /** Categories that became 100% cleared on the last won round */
  const [newlyMasteredCategories, setNewlyMasteredCategories] = useState<string[]>([]);
  /** True when the player just crossed 100 distinct words learned (Nexus goal) */
  const [nexus100UnlockedBanner, setNexus100UnlockedBanner] = useState(false);
  /** True when all today's quests completed on the last finished round */
  const [dailyQuestsMasterBanner, setDailyQuestsMasterBanner] = useState(false);

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

  /** Short guidance toast for taps on non-interactive areas (dead-click prevention) */
  const flashInfoToast = useCallback((msg: string) => {
    setInfoToast(msg);
    if (infoToastTimerRef.current !== null) window.clearTimeout(infoToastTimerRef.current);
    infoToastTimerRef.current = window.setTimeout(() => {
      infoToastTimerRef.current = null;
      setInfoToast(null);
    }, 2400);
  }, []);

  useEffect(() => {
    return () => {
      if (modeToastTimerRef.current !== null) window.clearTimeout(modeToastTimerRef.current);
      if (infoToastTimerRef.current !== null) window.clearTimeout(infoToastTimerRef.current);
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

  /** One-time contract matrix: lets you eyeball all (mode × wrong) combos in F12 */
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const rows: Record<string, unknown>[] = [];
    (["easy", "normal", "hard"] as const).forEach((d) => {
      for (let w = 0; w <= 6; w++) {
        const v = getVisibleHints(d, w);
        rows.push({
          mode: d,
          wrong: w,
          emoji: v.showEmoji,
          cat: v.showCategoryPill,
          meaning: v.showMeaning,
          def: v.showDefinition,
          ex: v.showExample,
          jamo: v.showJamo,
          kbRow: v.showKeyboardHelpRow,
          kbHi: v.highlightFullKeyboard,
          firstJamoHi: v.highlightFirstJamoOnly,
          lastCh: v.lastChanceEasy,
          safety: v.showHardSafetyBanner,
          dots: `${v.hintDotsFilled}/${v.hintDotsTotal}`,
        });
      }
    });
    console.groupCollapsed("[Hangle] Hint visibility contract · all modes × wrongs 0–6");
    console.table(rows);
    console.groupEnd();
  }, []);

  /** Log whenever the selected difficulty changes — useful for verifying mode-switch effects */
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (!difficulty) return;
    const v = getVisibleHints(difficulty, wrongGuessCount);
    console.groupCollapsed(
      `[Hangle] Difficulty is now ${difficulty.toUpperCase()} · current wrong=${wrongGuessCount}`,
    );
    console.log("Progress dots:", `${v.hintDotsFilled}/${v.hintDotsTotal}`, "·", v.dotsTitle);
    console.log("Next hint message:", v.nextHintSubtitle);
    console.table({
      showEmoji: v.showEmoji,
      showCategoryPill: v.showCategoryPill,
      showMeaning: v.showMeaning,
      tryGuessPlaceholder: v.tryGuessPlaceholder,
      showDefinition: v.showDefinition,
      showExample: v.showExample,
      showJamo: v.showJamo,
      showKeyboardHelpRow: v.showKeyboardHelpRow,
      lastChanceEasy: v.lastChanceEasy,
      showHardSafetyBanner: v.showHardSafetyBanner,
      highlightFullKeyboard: v.highlightFullKeyboard,
      highlightFirstJamoOnly: v.highlightFirstJamoOnly,
    });
    console.groupEnd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);

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
    (
      won: boolean,
      guessCount: number,
      kind: "daily" | "practice",
      bonusPhraseId?: number,
    ) => {
      setNewlyMasteredCategories([]);
      setNexus100UnlockedBanner(false);
      setDailyQuestsMasterBanner(false);

      const prevStats = loadStats();
      const prevLearnedCount = (prevStats.wordsLearned ?? []).length;
      const start = roundStartMsRef.current;
      const elapsed = start != null ? Date.now() - start : 0;
      roundStartMsRef.current = null;

      let st = mergeStatsAfterGameEnd(prevStats, won, guessCount, kind);
      st = addPlayTime(st, elapsed);
      if (kind === "practice") {
        st = appendPracticeClearedWord(st, answer);
      }
      if (won) {
        st = recordWordLearned(st, answer);
      }
      if (typeof bonusPhraseId === "number") {
        st = recordPhraseSeen(st, bonusPhraseId);
      }
      saveStats(st);
      setStats(st);

      const diff = difficulty ?? "normal";
      const beforeQuest = loadDailyQuests();
      const catUpper = (answerEntry.category ?? "").toUpperCase() || "OTHER";
      const nextQuest = applyQuestRound(beforeQuest, {
        won,
        guessCount,
        difficulty: diff,
        answerCategory: catUpper,
      });
      saveDailyQuests(nextQuest);
      setDailyQuestSnapshot(nextQuest);
      if (!allQuestsComplete(beforeQuest) && allQuestsComplete(nextQuest)) {
        setDailyQuestsMasterBanner(true);
      }

      const justUnlocked = getNewlyUnlocked(prevStats, st, WORDS);
      setNewlyUnlockedAchievements(justUnlocked);
      if (process.env.NODE_ENV === "development" && justUnlocked.length > 0) {
        console.log(
          "[Hangle] Achievements unlocked this round:",
          justUnlocked.map((a) => `${a.emoji} ${a.title}`).join(", "),
        );
      }

      if (won) {
        let mastered = getNewlyCompletedCategories(prevStats, st, WORDS);
        if (isNewlyKpopTagCorpusMaster(prevStats, st, WORDS)) {
          mastered = [...mastered, "K-POP"];
        }
        if (mastered.length > 0) setNewlyMasteredCategories(mastered);
      }

      const nowLearnedCount = (st.wordsLearned ?? []).length;
      if (won && nowLearnedCount > prevLearnedCount) {
        setWordsLearnedBump(true);
        window.setTimeout(() => setWordsLearnedBump(false), 1200);
      }
      if (won && prevLearnedCount < NEXUS_WORD_GOAL && nowLearnedCount >= NEXUS_WORD_GOAL) {
        setNexus100UnlockedBanner(true);
      }
      roundGamificationRef.current = {
        newDistinctWord: won && nowLearnedCount > prevLearnedCount,
        guessCount,
        wonIn3OrLess: won && guessCount >= 1 && guessCount <= 3,
      };
    },
    [answer, answerEntry.category, difficulty],
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

  // ─────────────────────────────────────────────────────────────────────
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

    if (process.env.NODE_ENV === "development" && !wonImmediate && !lostImmediate && difficulty) {
      const v = getVisibleHints(difficulty, newWrong);
      const label = `[Hangle] After attempt #${attemptNumber} · ${difficulty.toUpperCase()} · wrong=${newWrong}`;
      console.groupCollapsed(label);
      console.log("Wrong guesses:", newWrong, "(prev:", prevWrong, ")");
      console.log("Tier unlocked this submit:", hintTierUnlocked);
      console.log("Progress dots:", `${v.hintDotsFilled}/${v.hintDotsTotal}`, "·", v.dotsTitle);
      console.log("Next hint message:", v.nextHintSubtitle);
      console.table({
        showEmoji: v.showEmoji,
        showCategoryPill: v.showCategoryPill,
        showMeaning: v.showMeaning,
        tryGuessPlaceholder: v.tryGuessPlaceholder,
        showDefinition: v.showDefinition,
        showExample: v.showExample,
        showJamo: v.showJamo,
        showKeyboardHelpRow: v.showKeyboardHelpRow,
        lastChanceEasy: v.lastChanceEasy,
        showHardSafetyBanner: v.showHardSafetyBanner,
        highlightFullKeyboard: v.highlightFullKeyboard,
        highlightFirstJamoOnly: v.highlightFirstJamoOnly,
      });
      console.groupEnd();
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
      if (!statsRecorded) applyStatsOnce(true, nextGuesses.length, statsKind, picked.id);
      setStatsRecorded(true);
      persist("won", true, picked.id);
      setEndModal({ open: true, kind: "won" });
      return;
    }

    if (lostImmediate) {
      const picked = getNextPhrase(PHRASES);
      setBonusPhrase(picked);
      setStatus("lost");
      if (!statsRecorded) applyStatsOnce(false, nextGuesses.length, statsKind, picked.id);
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
    setNewlyUnlockedAchievements([]);
    setNewlyMasteredCategories([]);
    setNexus100UnlockedBanner(false);
    setDailyQuestsMasterBanner(false);
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

  /** Attempt grade for the *just-finished* round (used in result modal title) */
  const attemptGrade = useMemo(
    () => getAttemptGrade(guesses.length, status === "won"),
    [guesses.length, status],
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

  const streakShout = useMemo(() => {
    if (status !== "won" || sessionMode !== "daily") return null;
    const s = stats.currentStreak;
    if (s === 10) return "⚡ 10 STREAK! On fire!";
    if (s === 5) return "🔥 5 in a row!";
    return null;
  }, [status, sessionMode, stats.currentStreak]);

  const dailyQuestForUi = dailyQuestSnapshot ?? loadDailyQuests();

  /** Top 3 in-progress categories (for the compact result-modal preview) */
  const topInProgressCategories = useMemo(
    () =>
      categoryProgress
        .filter((c) => c.learned > 0 && c.learned < c.total)
        .slice(0, 3),
    [categoryProgress],
  );

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
            aria-label={`Nexus progress ${nexusLearnedDisplay} of ${NEXUS_WORD_GOAL} words, rank ${rankProgress.name}`}
            title="Open statistics"
            className="shrink-0 rounded-md px-0.5 py-1 text-[10px] font-bold tabular-nums hover:bg-stone-200/70 sm:text-[11px]"
            style={{ color: rankProgress.color }}
          >
            {nexusLearnedDisplay}/{NEXUS_WORD_GOAL}
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
            disabled={!difficulty}
            onClick={() => {
              if (!difficulty) return;
              setSettingsOpen(true);
            }}
            className={`flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-base leading-none sm:min-h-10 sm:min-w-10 ${
              difficulty
                ? "text-stone-700 hover:bg-stone-200/70 hover:text-stone-900"
                : "cursor-not-allowed text-stone-400"
            }`}
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
          <span
            aria-hidden="false"
            className={`shrink-0 cursor-default select-none rounded-full border px-1.5 py-0.5 text-[8px] font-medium uppercase leading-tight tracking-wide sm:px-2 sm:py-0.5 sm:text-[9px] ${
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
              className="shrink-0 rounded-full border border-amber-500/75 bg-[#f5f0e8] px-1.5 py-0.5 text-[8px] font-semibold tabular-nums leading-tight text-stone-900 shadow-sm ring-1 ring-amber-400/35 transition hover:bg-[#efe8dc] active:scale-[0.98] sm:px-2 sm:py-0.5 sm:text-[9px] sm:ring-2"
            >
              {difficultyBadgeLabel(difficulty)}
            </button>
          )}
          <span className="shrink-0 text-[8px] tabular-nums text-stone-500 sm:text-[9px]">
            Today · {playedToday}
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
        <AppToast variant="info" toastKey={infoToast} z={72}>
          {infoToast}
        </AppToast>
      )}

      {/* Hint unlock celebration */}
      {hintToastVisible && (
        <AppToast variant="info" toastKey="hint-unlocked" z={71}>
          💡 New hint unlocked!
        </AppToast>
      )}

      {/* Difficulty mode change confirmation */}
      {modeToast && (
        <AppToast variant="neutral" toastKey={modeToast} z={70}>
          {modeToast}
        </AppToast>
      )}

      <div className="shrink-0 px-0.5 text-center max-[480px]:py-0 sm:py-0.5">
        <p
          className={`truncate text-[12px] font-medium leading-snug text-stone-700 max-[480px]:text-[11px] sm:hidden ${difficulty ? "max-[480px]:hidden" : ""}`}
        >
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
                  ? "game-hint-card--easy max-h-[min(200px,26dvh)] max-[480px]:max-h-[min(150px,21dvh)] sm:max-h-[min(250px,30dvh)]"
                  : "max-h-[min(130px,18dvh)] max-[480px]:max-h-[min(112px,15dvh)] sm:max-h-[min(180px,24dvh)]"
              } ${hintCardPulse ? "hint-card-pulse-once" : ""}`}
            >
              <div className="shrink-0 cursor-default px-2.5 pb-1 pt-1.5 text-left max-[480px]:px-2 max-[480px]:pb-1 max-[480px]:pt-1.5 sm:px-3.5 sm:pb-1.5 sm:pt-2">
                {visible.showHintDotsRow && visible.hintDotsTotal > 0 && (
                  <div className="flex select-none items-center justify-between gap-2">
                    <span className="cursor-default font-serif text-[10px] font-semibold tabular-nums text-stone-800 sm:text-[11px]">
                      Hint {visible.hintProgressLabel}
                      <span className="ml-1 font-sans text-[9px] font-medium text-stone-500 sm:text-[10px]">
                        · {visible.dotsTitle}
                      </span>
                    </span>
                    <div className="flex shrink-0 cursor-default gap-1" aria-hidden>
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

                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {visible.showWordImage && showImage && imageSrc ? (
                    <div className="relative h-7 w-7 shrink-0 cursor-default select-none overflow-hidden rounded-lg border border-stone-300/50 bg-white/80 sm:h-9 sm:w-9">
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
                      className="flex h-7 w-7 shrink-0 cursor-default select-none items-center justify-center text-[1.15rem] leading-none sm:h-9 sm:w-9 sm:text-[1.45rem]"
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
                    <button
                      type="button"
                      aria-label={`Category hint: ${safeWordDisplay.categoryUpper}. Type the Korean word that fits this category.`}
                      onClick={() => {
                        flashInfoToast(
                          `Category clue · type the Korean word for this kind of ${safeWordDisplay.categoryUpper.toLowerCase()}!`,
                        );
                        if (process.env.NODE_ENV === "development") {
                          console.log(
                            "[Game] dead-click guard · category pill tapped:",
                            safeWordDisplay.categoryUpper,
                          );
                        }
                      }}
                      className="max-w-[min(100%,14rem)] shrink-0 truncate rounded-full border border-stone-400/55 bg-white/40 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-stone-800 transition hover:bg-white/70 active:scale-[0.98]"
                    >
                      {safeWordDisplay.categoryUpper}
                    </button>
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

              {/* Compact next-hint preview pinned at the bottom of the card. */}
              <div
                className="shrink-0 cursor-default select-none px-2.5 pb-1.5 pt-0.5 text-[10px] leading-snug text-stone-600 max-[480px]:px-2 sm:px-3.5 sm:pb-2 sm:text-[11px]"
                aria-live="polite"
              >
                {visible.nextHintPreview.kind === "tries" ? (
                  <>
                    <span className="font-semibold text-amber-800/90">⏳ Next hint</span>
                    <span className="text-stone-500"> in </span>
                    <span className="font-mono font-semibold tabular-nums text-stone-800">
                      {visible.nextHintPreview.tries}
                    </span>
                    <span className="text-stone-500">
                      {visible.nextHintPreview.tries === 1 ? " guess" : " guesses"} ·{" "}
                    </span>
                    <span className="font-semibold text-stone-800">
                      {visible.nextHintPreview.label}
                    </span>
                  </>
                ) : visible.nextHintPreview.kind === "finalGuess" ? (
                  <span className="font-semibold text-red-700">
                    🎯 Final guess — good luck! 💪
                  </span>
                ) : (
                  <span className="font-semibold text-amber-800/90">
                    🎯 All hints unlocked
                  </span>
                )}
              </div>
            </section>
          )}

          {visible.showHardCategoryStrip && (
            <section
              aria-label="Hard mode clues"
              className={`game-hint-card flex max-h-[min(120px,16dvh)] shrink-0 flex-col overflow-hidden rounded-xl border border-stone-300/55 bg-[var(--hint-card-bg)] shadow-sm transition-shadow max-[480px]:max-h-[min(104px,14dvh)] sm:max-h-[160px] ${hintCardPulse ? "hint-card-pulse-once" : ""}`}
            >
              <div className="cursor-default px-2.5 py-2 text-left sm:px-3.5 sm:py-2.5">
                {visible.showHintDotsRow && (
                  <div className="flex select-none items-center justify-between gap-2">
                    <span className="cursor-default font-serif text-[10px] font-semibold tabular-nums text-stone-800 sm:text-[11px]">
                      Hint {visible.hintProgressLabel}
                      <span className="ml-1 font-sans text-[9px] font-medium text-stone-500 sm:text-[10px]">
                        · {visible.dotsTitle}
                      </span>
                    </span>
                    <div className="flex shrink-0 cursor-default gap-1" aria-hidden>
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
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Category hint: ${safeWordDisplay.categoryUpper}. Type the Korean word that fits this category.`}
                    onClick={() => {
                      flashInfoToast(
                        `Category clue · type the Korean word for this kind of ${safeWordDisplay.categoryUpper.toLowerCase()}!`,
                      );
                      if (process.env.NODE_ENV === "development") {
                        console.log(
                          "[Game] dead-click guard · hard category pill tapped:",
                          safeWordDisplay.categoryUpper,
                        );
                      }
                    }}
                    className="max-w-full shrink-0 truncate rounded-full border border-stone-400/55 bg-white/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-800 transition hover:bg-white/70 active:scale-[0.98] sm:text-[11px]"
                  >
                    {safeWordDisplay.categoryUpper}
                  </button>
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

              {/* Compact next-hint preview pinned at the bottom of the HARD card. */}
              <div
                className="shrink-0 cursor-default select-none px-2.5 pb-1.5 pt-0.5 text-[10px] leading-snug text-stone-600 sm:px-3.5 sm:pb-2 sm:text-[11px]"
                aria-live="polite"
              >
                {visible.nextHintPreview.kind === "tries" ? (
                  <>
                    <span className="font-semibold text-amber-800/90">⏳ Next hint</span>
                    <span className="text-stone-500"> in </span>
                    <span className="font-mono font-semibold tabular-nums text-stone-800">
                      {visible.nextHintPreview.tries}
                    </span>
                    <span className="text-stone-500">
                      {visible.nextHintPreview.tries === 1 ? " guess" : " guesses"} ·{" "}
                    </span>
                    <span className="font-semibold text-stone-800">
                      {visible.nextHintPreview.label}
                    </span>
                  </>
                ) : visible.nextHintPreview.kind === "finalGuess" ? (
                  <span className="font-semibold text-red-700">
                    🎯 Final guess — good luck! 💪
                  </span>
                ) : (
                  <span className="font-semibold text-amber-800/90">
                    🎯 All hints unlocked
                  </span>
                )}
              </div>
            </section>
          )}
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
                if (
                  status !== "playing" ||
                  !hydrated ||
                  difficulty === null ||
                  rowRevealBlock
                ) {
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

        <div className="game-keyboard-zone mt-0 w-full shrink-0 overflow-x-hidden overflow-y-visible pt-0 max-[480px]:max-h-[min(180px,30dvh)] sm:mt-auto sm:max-h-none sm:overflow-y-auto sm:pt-0.5">
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
              Korean Master (Nexus) bar and Today&apos;s Quests moved here from the home screen — see{" "}
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
                🎯 Today&apos;s Quests
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
                  <span aria-hidden>{dailyQuestForUi.playedHardToday ? "⭐" : "□"}</span>
                  Try HARD mode
                </li>
                <li className="flex items-center gap-1.5">
                  <span aria-hidden>{dailyQuestForUi.wonFoodToday ? "⭐" : "□"}</span>
                  Solve a FOOD word
                </li>
              </ul>
              {allQuestsComplete(dailyQuestForUi) && (
                <p className="mt-2 text-center text-[10px] font-bold text-amber-800">
                  Daily Master! ⭐⭐⭐
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
            className="max-h-[90dvh] w-[min(100%,90vw)] max-w-[90vw] overflow-y-auto rounded-xl border border-stone-200 bg-[#fafaf9] p-4 font-sans shadow-xl sm:max-w-sm sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="result-title" className="font-serif text-[clamp(1.125rem,4vw,1.375rem)] text-stone-900 sm:text-2xl">
              {endModal.kind === "won"
                ? `🎉 You won in ${guesses.length} ${guesses.length === 1 ? "try" : "tries"}!`
                : "Better luck next time!"}
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              {endModal.kind === "won"
                ? `${attemptGrade.emoji ? `${attemptGrade.emoji} ` : ""}${attemptGrade.title}`
                : `${guesses.length}/6 tries`}
            </p>

            {endModal.kind === "won" && attemptGrade.stars > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div
                  className="flex select-none gap-0.5"
                  aria-label={`Rating: ${attemptGrade.stars} of 6 stars`}
                >
                  {Array.from({ length: 6 }, (_, i) => (
                    <span
                      key={i}
                      className={`text-base sm:text-lg ${i < attemptGrade.stars ? "text-amber-500" : "text-stone-200"}`}
                      aria-hidden
                    >
                      ★
                    </span>
                  ))}
                </div>
              </div>
            )}

            {nexus100UnlockedBanner && (
              <div className="mt-3 rounded-xl border-2 border-rose-400 bg-gradient-to-b from-rose-50 to-white p-3 text-center shadow-sm">
                <p className="font-serif text-lg font-bold text-rose-800 sm:text-xl">
                  🎉 KOREAN MASTER UNLOCKED! 👑
                </p>
                <p className="mt-1 text-sm text-rose-900">You&apos;ve mastered 100 Korean words!</p>
                <button
                  type="button"
                  className="mt-2 w-full rounded-lg border border-rose-300 bg-white py-2 text-xs font-semibold text-rose-900 shadow-sm hover:bg-rose-50"
                  onClick={handleBragCopy}
                >
                  Share your achievement
                </button>
              </div>
            )}

            {dailyQuestsMasterBanner && (
              <p className="mt-3 text-center text-sm font-bold text-amber-800">
                Daily Master! ⭐⭐⭐
              </p>
            )}

            {newlyMasteredCategories.length > 0 && (
              <div className="mt-3 space-y-1 rounded-lg border border-emerald-300/70 bg-emerald-50/80 px-3 py-2">
                {newlyMasteredCategories.map((cat) => (
                  <p
                    key={cat}
                    className="text-center text-sm font-bold text-emerald-900"
                  >
                    🏅 {cat === "K-POP" ? "K-pop" : cat} Master unlocked!
                  </p>
                ))}
              </div>
            )}

            {endModal.kind === "won" && (
              <div className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-white/80 px-3 py-2.5 shadow-sm">
                {roundGamificationRef.current.newDistinctWord && (
                  <>
                    <p className="text-center text-sm font-bold text-stone-900">+1 word!</p>
                    {nexusLearnedDisplay < NEXUS_WORD_GOAL && (
                      <p className="text-center text-xs text-stone-600">
                        {NEXUS_WORD_GOAL - nexusLearnedDisplay} words to Korean Master 👑
                      </p>
                    )}
                  </>
                )}
                <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">
                  📚 Words learned: {nexusLearnedDisplay}/{NEXUS_WORD_GOAL}
                </p>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200"
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
                <p className="text-[10px] text-stone-500">{nexusPctDisplay}%</p>

                <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">
                  🏆 Quest progress
                </p>
                <ul className="space-y-0.5 text-[11px] text-stone-700">
                  <li className="flex items-start gap-1.5">
                    <span aria-hidden>{dailyQuestForUi.gamesFinished >= 3 ? "✅" : "□"}</span>
                    <span>
                      Play 3 games ({Math.min(3, dailyQuestForUi.gamesFinished)}/3)
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span aria-hidden>{dailyQuestForUi.wonInThreeOrFewer ? "✅" : "□"}</span>
                    <span>
                      Win in 3 tries or less
                      {roundGamificationRef.current.wonIn3OrLess ? " (just did!)" : ""}
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span aria-hidden>{dailyQuestForUi.playedHardToday ? "✅" : "□"}</span>
                    <span>Try HARD mode</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span aria-hidden>{dailyQuestForUi.wonFoodToday ? "✅" : "□"}</span>
                    <span>Solve a FOOD word</span>
                  </li>
                </ul>

                {streakShout && (
                  <p className="text-center text-sm font-bold text-orange-700">{streakShout}</p>
                )}
                {sessionMode === "daily" && !streakShout && stats.currentStreak > 0 && (
                  <p className="text-center text-xs font-semibold text-stone-700">
                    Streak: {stats.currentStreak} daily win{stats.currentStreak === 1 ? "" : "s"} in a row
                  </p>
                )}
                {sessionMode === "practice" && (
                  <p className="text-center text-[10px] text-stone-500">
                    Practice rounds don&apos;t change your daily streak.
                  </p>
                )}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {endModal.kind === "lost" ? "The word was" : "Answer"}
              </p>
              {safeWordDisplay.isKpop && (
                <span
                  className="cursor-default select-none rounded-full border border-pink-300/70 bg-pink-50/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pink-700 shadow-sm"
                  title="This word is often heard in Korean pop music"
                >
                  🎵 K-pop word
                </span>
              )}
            </div>
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

            <div className="mt-5 rounded-xl border border-amber-300/60 bg-amber-50/55 p-3 shadow-sm">
              <p className="cursor-default text-center text-[10px] font-bold uppercase tracking-[0.14em] text-amber-900/80">
                🎓 Your Korean Journey
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="cursor-default text-left">
                  <p
                    className={`font-serif text-2xl font-semibold text-stone-900 tabular-nums ${wordsLearnedBump ? "hint-card-pulse-once" : ""}`}
                  >
                    {wordsLearnedList.length}
                  </p>
                  <p className="text-[9px] uppercase tracking-wide text-stone-500">
                    Words learned
                  </p>
                </div>
                <div className="cursor-default text-right">
                  <p className="text-[13px] font-semibold text-stone-900">
                    <span aria-hidden className="mr-1">
                      {levelInfo.emoji}
                    </span>
                    {levelInfo.current}
                  </p>
                  <p className="text-[9px] text-stone-500">
                    {levelInfo.nextLevel
                      ? `${levelInfo.wordsToNext} more to ${levelInfo.nextLevel}`
                      : "Max level — 잘했어!"}
                  </p>
                </div>
              </div>
              <div
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-stone-200/80"
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
              <p className="mt-2 cursor-default text-center text-[10px] leading-snug text-stone-600">
                💬 {phrasesLearnedCount} bonus phrase{phrasesLearnedCount === 1 ? "" : "s"} seen ·{" "}
                {WORDS.length}+ Korean words to discover
              </p>

              <div className="mt-3 cursor-default rounded-lg border border-pink-300/55 bg-pink-50/70 px-2.5 py-1.5">
                <div className="flex items-baseline justify-between text-[10px] text-pink-900">
                  <span className="font-bold uppercase tracking-wide">
                    🎵 K-pop word collection
                  </span>
                  <span className="font-mono tabular-nums text-pink-700">
                    {kpopProgress.learned}/{kpopProgress.total}
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
              </div>

              {topInProgressCategories.length > 0 && (
                <div className="mt-3 border-t border-amber-300/40 pt-3">
                  <p className="cursor-default text-[9px] font-bold uppercase tracking-wide text-stone-500">
                    🏆 Category progress
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {topInProgressCategories.map((c) => (
                      <div key={c.category} className="cursor-default">
                        <div className="flex items-baseline justify-between text-[10px] text-stone-700">
                          <span className="font-semibold uppercase tracking-wide">
                            {c.category}
                          </span>
                          <span className="font-mono tabular-nums text-stone-500">
                            {c.learned}/{c.total}
                          </span>
                        </div>
                        <div
                          className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-200/80"
                          role="progressbar"
                          aria-valuenow={c.percent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full rounded-full bg-amber-500 transition-all duration-700 ease-out"
                            style={{ width: `${c.percent}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {newlyUnlockedAchievements.length > 0 && (
              <div className="hint-card-pulse-once mt-4 rounded-xl border-2 border-amber-400/80 bg-amber-50/90 p-3 shadow-sm sm:p-4">
                <p className="cursor-default text-center text-[11px] font-bold uppercase tracking-[0.14em] text-amber-900 sm:text-xs">
                  🎉 Achievement{newlyUnlockedAchievements.length > 1 ? "s" : ""} unlocked!
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {newlyUnlockedAchievements.map((a) => (
                    <div
                      key={a.id}
                      className="hint-fade-in flex flex-col items-center rounded-lg border border-amber-300/70 bg-white/90 px-3 py-2 shadow-sm"
                    >
                      <span
                        aria-hidden
                        className="select-none text-2xl leading-none"
                        style={{
                          fontFamily:
                            "system-ui, 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif",
                        }}
                      >
                        {a.emoji}
                      </span>
                      <span className="mt-1 cursor-default text-[10px] font-bold uppercase tracking-wide text-stone-900 sm:text-[11px]">
                        {a.title}
                      </span>
                      <span className="cursor-default text-[8px] leading-snug text-stone-500 sm:text-[9px]">
                        {a.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
              onClick={handleResultClose}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-base font-bold text-white shadow-md transition hover:bg-amber-600 active:scale-[0.99] min-h-[52px]"
            >
              <span aria-hidden className="text-xl leading-none">
                🇰🇷
              </span>
              <span>Play Another Word</span>
              <span aria-hidden className="text-lg leading-none">
                →
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="mt-3 w-full rounded-xl border border-stone-400/70 bg-[#f5f0e8] py-2.5 text-sm font-medium text-stone-800 shadow-sm transition hover:bg-[#efe8dc] min-h-[44px]"
            >
              💬 Send Feedback
            </button>

            <button
              type="button"
              className="mt-3 w-full rounded-md border border-stone-300 bg-white py-2 text-xs text-stone-500 hover:bg-stone-50 min-h-[40px]"
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
