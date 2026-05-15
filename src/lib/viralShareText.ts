import type { Difficulty } from "@/lib/difficulty";
import { tileToEmoji } from "@/lib/evaluate";
import type { PuzzleMode, TileState } from "@/types/game";

const MODE_EMOJI: Record<Difficulty, string> = {
  easy: "🟢",
  normal: "🟡",
  hard: "🔴",
};

const MODE_LABEL: Record<Difficulty, string> = {
  easy: "EASY",
  normal: "NORMAL",
  hard: "HARD",
};

export function buildViralShareText(opts: {
  dayNumber: number;
  sessionMode: PuzzleMode;
  status: "won" | "lost";
  guessCount: number;
  difficulty: Difficulty;
  evaluations: TileState[][];
  answerLength: number;
  shareBaseUrl: string;
}): string {
  const tries = opts.status === "won" ? String(opts.guessCount) : "X";
  const practice = opts.sessionMode === "practice" ? " (Practice)" : "";
  const emoji = MODE_EMOJI[opts.difficulty];
  const label = MODE_LABEL[opts.difficulty];

  const emojiLines = (opts.evaluations ?? [])
    .filter((row) => row.length === opts.answerLength)
    .map((row) => row.map(tileToEmoji).join(""));

  const emojiBlock = emojiLines.join("\n");

  const base =
    typeof opts.shareBaseUrl === "string" && opts.shareBaseUrl.trim() !== ""
      ? opts.shareBaseUrl.trim().replace(/\/+$/, "")
      : "https://hangle-three.vercel.app";

  const urlWithSlash = base.endsWith("/") ? base : `${base}/`;
  const displayUrl = urlWithSlash.replace(/\/+$/, "") || urlWithSlash;

  return [
    `Hangle #${opts.dayNumber}${practice} ${tries}/6 ${emoji} ${label}`,
    "",
    emojiBlock,
    "",
    "Can you beat me?",
    `🇰🇷 ${displayUrl}`,
    "",
    "#LearnKorean #KoreanWordle",
  ].join("\n");
}
