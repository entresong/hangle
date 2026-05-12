import Hangul from "hangul-js";

const SYL = /^[\uAC00-\uD7A3]$/;

export function isCompleteHangulSyllable(ch: string): boolean {
  return SYL.test(ch);
}

export function parseAssembled(s: string): { syllables: string[]; trailing: string } {
  const syllables: string[] = [];
  let trailing = "";
  for (const ch of s) {
    if (isCompleteHangulSyllable(ch)) syllables.push(ch);
    else trailing += ch;
  }
  return { syllables, trailing };
}

export function countCompleteSyllables(s: string): number {
  return parseAssembled(s).syllables.length;
}

export function appendJamo(buffer: string[], jamo: string): string[] {
  return [...buffer, jamo];
}

export function backspaceJamo(buffer: string[]): string[] {
  if (buffer.length === 0) return buffer;
  return buffer.slice(0, -1);
}

export function assembleBuffer(buffer: string[]): string {
  if (buffer.length === 0) return "";
  return Hangul.assemble(buffer);
}

export function canAcceptJamo(buffer: string[], jamo: string, maxSyllables: number): boolean {
  const next = appendJamo(buffer, jamo);
  const assembled = assembleBuffer(next);
  return countCompleteSyllables(assembled) <= maxSyllables;
}
