import type { TileState } from "@/types/game";
import { evaluationsToEmojiLines } from "@/lib/hintRevealStorage";

export const DEFAULT_SHARE_BASE = "https://hangle-three.vercel.app";

export type ShareUtmContent =
  | "result_genius"
  | "result_2tries"
  | "result_3tries"
  | "result_4_5tries"
  | "result_6tries"
  | "result_fail"
  | "mid_game"
  | "header";

export function resolveShareBaseUrl(envUrl?: string): string {
  const raw =
    (typeof envUrl === "string" && envUrl.trim()) ||
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SITE_URL?.trim()) ||
    DEFAULT_SHARE_BASE;
  return raw.replace(/\/+$/, "");
}

export function utmContentForResult(won: boolean, tries: number): ShareUtmContent {
  if (!won) return "result_fail";
  if (tries <= 1) return "result_genius";
  if (tries <= 3) return tries === 2 ? "result_2tries" : "result_3tries";
  if (tries <= 5) return "result_4_5tries";
  return "result_6tries";
}

export function buildShareUrl(base: string, utmContent: ShareUtmContent): string {
  const u = new URL("/", base.endsWith("/") ? base : `${base}/`);
  u.searchParams.set("utm_source", "share");
  u.searchParams.set("utm_medium", "organic");
  u.searchParams.set("utm_campaign", "beta");
  u.searchParams.set("utm_content", utmContent);
  return u.toString();
}

export type ShareBodyKind =
  | "result_genius"
  | "result_2_3"
  | "result_4_5"
  | "result_6"
  | "result_fail"
  | "mid_game";

export function buildShareBodyText(opts: {
  kind: ShareBodyKind;
  /** Korean answer — only for result_2_3 when won */
  answerWord?: string;
  tries?: number;
}): string {
  const common =
    "Hangle — Korean word puzzle game\nfor K-pop, K-drama, and 한국어 lovers.";
  switch (opts.kind) {
    case "result_genius":
      return [
        "GENIUS! I cracked Hangle in just 1 try 🤯",
        "",
        common,
        "",
        "Bet you can't →",
      ].join("\n");
    case "result_2_3": {
      const n = opts.tries ?? 2;
      const w = opts.answerWord ?? "…";
      return [
        `I solved ${w} in ${n} tries 🇰🇷`,
        "",
        common,
        "",
        "Your turn →",
      ].join("\n");
    }
    case "result_4_5": {
      const n = opts.tries ?? 4;
      return [
        `Made it through Hangle in ${n} tries 🇰🇷`,
        "",
        common,
        "",
        "Think you can do better? →",
      ].join("\n");
    }
    case "result_6":
      return [
        "Just barely solved Hangle 😅",
        "",
        common,
        "",
        "Your turn →",
      ].join("\n");
    case "result_fail":
      return [
        "This Hangle round stumped me 😅",
        "",
        common,
        "",
        "Can you crack it? →",
      ].join("\n");
    case "mid_game":
    default:
      return [
        "Playing Hangle right now 🇰🇷",
        "",
        common,
        "",
        "Join me →",
      ].join("\n");
  }
}

export function buildFullSharePayload(opts: {
  won: boolean;
  tries: number;
  answerWord: string;
  evaluations: TileState[][];
  answerLength: number;
  utmContent: ShareUtmContent;
  baseUrl: string;
}): { text: string; url: string } {
  const url = buildShareUrl(opts.baseUrl, opts.utmContent);
  let kind: ShareBodyKind = "mid_game";
  if (opts.utmContent.startsWith("result_")) {
    if (!opts.won) kind = "result_fail";
    else if (opts.tries <= 1) kind = "result_genius";
    else if (opts.tries <= 3) kind = "result_2_3";
    else if (opts.tries <= 5) kind = "result_4_5";
    else kind = "result_6";
  } else {
    kind = "mid_game";
  }
  const body = buildShareBodyText({
    kind,
    answerWord: opts.answerWord,
    tries: opts.tries,
  });
  const grid = evaluationsToEmojiLines(opts.evaluations, opts.answerLength);
  const text =
    opts.utmContent === "mid_game" || opts.utmContent === "header"
      ? `${body}\n\n${url}`
      : [`${body}`, "", grid, "", url].join("\n");
  return { text, url };
}
