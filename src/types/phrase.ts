export type PhraseLevel = "BEGINNER" | "INTERMEDIATE";

export type PhraseCategory =
  | "GREETING"
  | "THANKS"
  | "MEAL"
  | "QUESTION"
  | "ANSWER"
  | "REQUEST"
  | "EMOTION";

export type PhraseEntry = {
  id: number;
  phrase: string;
  meaning: string;
  definition: string;
  example: string;
  usage: string;
  level: PhraseLevel;
  category: PhraseCategory;
  emoji: string;
};
