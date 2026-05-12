/** Escape string for safe use inside `RegExp` constructor. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace every occurrence of `answer` with `replacement` (default `____`).
 * Used during play so examples/definitions never leak the solution; keep words.json unchanged.
 */
export function maskAnswerInText(
  text: string,
  answer: string,
  replacement = "____",
): string {
  if (text == null || typeof text !== "string") return "";
  const a = typeof answer === "string" ? answer.trim() : "";
  if (!a) return text;
  return text.replace(new RegExp(escapeRegExp(a), "g"), replacement);
}
