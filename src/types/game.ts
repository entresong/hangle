export type TileState = "correct" | "present" | "absent";

export type GameStatus = "playing" | "won" | "lost";

export type WordEntry = {
  word: string;
  /** Hangul 완성형 음절 개수 (= `word.length` 일반적으로); 명시 시 검증·격자에 사용 */
  length?: number;
  emoji: string;
  category: string;
  meaning: string;
  /** Short English gloss for learners */
  definition: string;
  /** English + Korean in parentheses */
  example: string;
  /** When set (e.g. `/images/foo.png`), shown instead of emoji until load error */
  image?: string;
  /** Reserved for future image generation scripts */
  imagePrompt?: string;
};

export type PuzzleMode = "daily" | "practice";

export type PersistedGame = {
  puzzleDate: string;
  guesses: string[];
  evaluations: TileState[][];
  status: GameStatus;
  statsRecorded?: boolean;
  /** Official UTC puzzle vs bonus rounds after finishing */
  mode?: PuzzleMode;
  /** Answer when `mode` is `practice` (daily answer is always derived from date) */
  practiceAnswer?: string;
  /** Bonus phrase card shown when this round ended (stable across reloads) */
  bonusPhraseId?: number;
};

export type PersistedStats = {
  gamesPlayed: number;
  gamesWon: number;
  guessDistribution: [number, number, number, number, number, number];
  currentStreak: number;
  maxStreak: number;
  totalGuessesOnWins: number;
  lastCompletedPuzzleDate: string | null;
  /** UTC YYYY-MM-DD that `gamesFinishedToday` applies to */
  utcStatsDate?: string | null;
  /** Finished games (daily + practice) for `utcStatsDate` */
  gamesFinishedToday?: number;
  /** Practice answers cleared (win or loss); used to rotate words */
  practiceSolvedWords?: string[];
  /** Wins solved in exactly one guess (daily + practice) */
  oneGuessWins?: number;
};
