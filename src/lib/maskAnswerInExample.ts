/**
 * Replace every occurrence of the answer word with Hangul ○ masks
 * (one ○ per Unicode code point in the answer, typically one per syllable).
 */
export function maskAnswerInExampleText(text: string, answer: string): string {
  if (!text || !answer) return text;
  const word = answer.trim();
  if (!word) return text;
  const mask = "○".repeat([...word].length);
  let out = text;
  let from = 0;
  while (from <= out.length) {
    const i = out.indexOf(word, from);
    if (i === -1) break;
    out = out.slice(0, i) + mask + out.slice(i + word.length);
    from = i + mask.length;
  }
  return out;
}
