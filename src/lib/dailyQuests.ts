import { getUtcDateString } from "@/lib/dailyWord";
import type { Difficulty } from "@/lib/difficulty";

export type DailyQuestState = {
  /** UTC YYYY-MM-DD this blob applies to */
  date: string;
  /** Finished games today (daily + practice) */
  gamesFinished: number;
  /** Won at least one game in ≤3 tries today */
  wonInThreeOrFewer: boolean;
  /** Finished at least one game on HARD today */
  playedHardToday: boolean;
  /** Won at least one FOOD-category word today */
  wonFoodToday: boolean;
};

const questKey = (date: string) => `hangle_quests_${date}`;

export function defaultDailyQuests(date: string): DailyQuestState {
  return {
    date,
    gamesFinished: 0,
    wonInThreeOrFewer: false,
    playedHardToday: false,
    wonFoodToday: false,
  };
}

export function loadDailyQuests(): DailyQuestState {
  const today = getUtcDateString();
  if (typeof window === "undefined") return defaultDailyQuests(today);
  try {
    const raw = localStorage.getItem(questKey(today));
    if (!raw) return defaultDailyQuests(today);
    const parsed = JSON.parse(raw) as Partial<DailyQuestState>;
    if (parsed.date !== today) return defaultDailyQuests(today);
    return {
      date: today,
      gamesFinished: Math.max(0, Number(parsed.gamesFinished) || 0),
      wonInThreeOrFewer: Boolean(parsed.wonInThreeOrFewer),
      playedHardToday: Boolean(parsed.playedHardToday),
      wonFoodToday: Boolean(parsed.wonFoodToday),
    };
  } catch {
    return defaultDailyQuests(today);
  }
}

export function saveDailyQuests(state: DailyQuestState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(questKey(state.date), JSON.stringify(state));
}

export type QuestRoundEvent = {
  won: boolean;
  guessCount: number;
  difficulty: Difficulty;
  /** Uppercase category of the answer word */
  answerCategory: string;
};

export function applyQuestRound(prev: DailyQuestState, ev: QuestRoundEvent): DailyQuestState {
  const today = getUtcDateString();
  const base = prev.date === today ? prev : defaultDailyQuests(today);
  const gamesFinished = base.gamesFinished + 1;
  const wonInThreeOrFewer =
    base.wonInThreeOrFewer || (ev.won && ev.guessCount >= 1 && ev.guessCount <= 3);
  const playedHardToday = base.playedHardToday || ev.difficulty === "hard";
  const wonFoodToday =
    base.wonFoodToday || (ev.won && ev.answerCategory.toUpperCase() === "FOOD");
  return {
    date: today,
    gamesFinished,
    wonInThreeOrFewer,
    playedHardToday,
    wonFoodToday,
  };
}

export function allQuestsComplete(q: DailyQuestState): boolean {
  return (
    q.gamesFinished >= 3 &&
    q.wonInThreeOrFewer &&
    q.playedHardToday &&
    q.wonFoodToday
  );
}
