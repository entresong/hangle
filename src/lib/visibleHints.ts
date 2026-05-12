import type { Difficulty } from "@/lib/difficulty";

export type VisibleHints = {
  variant: Difficulty;
  /** Large card (Easy + Normal) */
  showFullHintCard: boolean;
  /** HARD: thin strip with category (+ optional safety) */
  showHardCategoryStrip: boolean;
  showHintDotsRow: boolean;
  hintDotsTotal: number;
  hintDotsFilled: number;
  hintProgressLabel: string;
  /** Short label next to dot row */
  dotsTitle: string;
  nextHintSubtitle: string;
  showEmoji: boolean;
  showWordImage: boolean;
  showCategoryPill: boolean;
  showMeaning: boolean;
  /** “Try to guess…” (Normal before meaning unlock) */
  tryGuessPlaceholder: boolean;
  showDefinition: boolean;
  showExample: boolean;
  showJamo: boolean;
  showKeyboardHelpRow: boolean;
  lastChanceEasy: boolean;
  showHardSafetyBanner: boolean;
  hardSafetyTitle: string;
  highlightFullKeyboard: boolean;
  highlightFirstJamoOnly: boolean;
};

/**
 * Pure hint visibility for the current difficulty and wrong-guess count.
 * `wrongGuessCount` = number of submitted guesses that were not the answer.
 *
 * Easy (sequential): 0 → emoji + category + meaning; ≥1 definition; ≥2 example;
 * ≥3 first-syllable jamo; ≥4 keyboard jamo highlight; ≥5 last-chance strip.
 */
export function getVisibleHints(difficulty: Difficulty, wrongGuessCount: number): VisibleHints {
  if (difficulty === "easy") {
    const showDefinition = wrongGuessCount >= 1;
    const showExample = wrongGuessCount >= 2;
    const showJamo = wrongGuessCount >= 3;
    const highlightFullKeyboard = wrongGuessCount >= 4;
    const lastChanceEasy = wrongGuessCount >= 5;
    return {
      variant: "easy",
      showFullHintCard: true,
      showHardCategoryStrip: false,
      showHintDotsRow: true,
      hintDotsTotal: 5,
      hintDotsFilled: Math.min(wrongGuessCount, 5),
      hintProgressLabel: `${Math.min(wrongGuessCount, 5)}/5`,
      dotsTitle: "Learner hints",
      nextHintSubtitle:
        wrongGuessCount >= 5
          ? "All 5 extra hints unlocked."
          : wrongGuessCount === 0
            ? "Definition unlocks after your first wrong guess."
            : wrongGuessCount === 1
              ? "Example unlocks after one more wrong guess."
              : wrongGuessCount === 2
                ? "First-syllable jamo unlocks after one more wrong guess."
                : wrongGuessCount === 3
                  ? "Keyboard jamo highlight unlocks after one more wrong guess."
                  : "Last-chance clue unlocks after one more wrong guess.",
      showEmoji: true,
      showWordImage: true,
      showCategoryPill: true,
      showMeaning: true,
      tryGuessPlaceholder: false,
      showDefinition,
      showExample,
      showJamo,
      showKeyboardHelpRow: highlightFullKeyboard,
      lastChanceEasy,
      showHardSafetyBanner: false,
      hardSafetyTitle: "",
      highlightFullKeyboard,
      highlightFirstJamoOnly: false,
    };
  }

  if (difficulty === "normal") {
    const showMeaning = wrongGuessCount >= 3;
    const highlightFullKeyboard = wrongGuessCount >= 5;
    const filled = (showMeaning ? 1 : 0) + (highlightFullKeyboard ? 1 : 0);
    return {
      variant: "normal",
      showFullHintCard: true,
      showHardCategoryStrip: false,
      showHintDotsRow: true,
      hintDotsTotal: 2,
      hintDotsFilled: filled,
      hintProgressLabel: `${filled}/2`,
      dotsTitle: "Limited hints",
      nextHintSubtitle:
        wrongGuessCount < 3
          ? "English meaning unlocks after 3 wrong guesses."
          : wrongGuessCount < 5
            ? "Keyboard jamo highlight unlocks after 5 wrong guesses."
            : "All Normal hints unlocked.",
      showEmoji: true,
      showWordImage: true,
      showCategoryPill: true,
      showMeaning,
      tryGuessPlaceholder: !showMeaning,
      showDefinition: false,
      showExample: false,
      showJamo: false,
      showKeyboardHelpRow: highlightFullKeyboard,
      lastChanceEasy: false,
      showHardSafetyBanner: false,
      hardSafetyTitle: "",
      highlightFullKeyboard,
      highlightFirstJamoOnly: false,
    };
  }

  const safety = wrongGuessCount >= 5;
  return {
    variant: "hard",
    showFullHintCard: false,
    showHardCategoryStrip: true,
    showHintDotsRow: true,
    hintDotsTotal: 1,
    hintDotsFilled: safety ? 1 : 0,
    hintProgressLabel: `${safety ? 1 : 0}/1`,
    dotsTitle: "Hard mode",
    nextHintSubtitle: safety
      ? "First jamo of the answer is ringed on the keyboard."
      : "Category + tile colors only. Safety hint after 5 wrong guesses.",
    showEmoji: false,
    showWordImage: false,
    showCategoryPill: true,
    showMeaning: false,
    tryGuessPlaceholder: false,
    showDefinition: false,
    showExample: false,
    showJamo: false,
    showKeyboardHelpRow: false,
    lastChanceEasy: false,
    showHardSafetyBanner: safety,
    hardSafetyTitle: "Almost out of tries!",
    highlightFullKeyboard: false,
    highlightFirstJamoOnly: safety,
  };
}
