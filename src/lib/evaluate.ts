import type { TileState } from "@/types/game";

export type EvaluateDebugMeta = {
  attemptNumber: number;
  /** After this submit, UI will unlock the next draft row (game still playing). */
  shouldMoveToNextRow: boolean;
};

export function evaluateGuess(
  answer: string,
  guess: string,
  debug?: EvaluateDebugMeta,
): TileState[] {
  const A = [...answer];
  const G = [...guess];
  const result: TileState[] = G.map(() => "absent");
  const counts = new Map<string, number>();
  for (const ch of A) counts.set(ch, (counts.get(ch) ?? 0) + 1);

  for (let i = 0; i < G.length; i++) {
    if (G[i] === A[i]) {
      result[i] = "correct";
      const ch = G[i]!;
      counts.set(ch, (counts.get(ch) ?? 0) - 1);
    }
  }
  for (let i = 0; i < G.length; i++) {
    if (result[i] === "correct") continue;
    const ch = G[i]!;
    if ((counts.get(ch) ?? 0) > 0) {
      result[i] = "present";
      counts.set(ch, (counts.get(ch) ?? 0) - 1);
    }
  }

  if (process.env.NODE_ENV === "development" && debug) {
    console.log("Try #:", debug.attemptNumber);
    console.log("User guess:", guess, "length:", guess.length);
    console.log("Correct answer:", answer, "length:", answer.length);
    console.log("Color feedback:", result);
    console.log("Move to next row:", debug.shouldMoveToNextRow);
  }

  return result;
}

export function tileToEmoji(t: TileState): string {
  if (t === "correct") return "🟩";
  if (t === "present") return "🟨";
  return "⬜";
}
