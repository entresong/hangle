/**
 * Batch-generates word illustrations via Pollinations image API.
 *
 * Authenticated (recommended): set `POLLINATIONS_API_KEY` in `.env.local`.
 *   — Uses `Authorization: Bearer` plus `?key=` (per Pollinations APIDOCS).
 *   — ~5s tier rate limit → we wait **6s** between successful request chains.
 *
 * Anonymous fallback: if the key is missing/empty, same GET URL without auth;
 *   — ~15s tier → we wait **16s** between calls.
 *
 * GET https://image.pollinations.ai/prompt/[ENCODED_PROMPT]?model=flux&width=1024&height=1024&nologo=true
 *
 * Run: npx tsx scripts/generate-images.ts [--force]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const ROOT = process.cwd();

dotenv.config({ path: path.join(ROOT, ".env.local") });

const DELAY_MS_AUTH = 6_000;
const DELAY_MS_ANON = 16_000;

const MASTER_SUFFIX =
  ", minimalist illustration, hand-drawn style, warm beige background, soft pastel colors, simple flat design, no text, no shadows, centered composition, Korean cultural aesthetic, 2D illustration style";

type WordRow = Record<string, unknown> & {
  word: string;
  image?: string;
  imagePrompt?: string;
};

function buildFullPrompt(imagePrompt: string): string {
  return `${imagePrompt.trim()}${MASTER_SUFFIX}`;
}

/** Pollinations: Bearer header and/or `key` query (see APIDOCS 401 table). */
function buildPollinationsUrl(prompt: string, apiKey?: string): string {
  const encoded = encodeURIComponent(prompt);
  const qs = new URLSearchParams({
    model: "flux",
    width: "1024",
    height: "1024",
    nologo: "true",
  });
  if (apiKey) {
    qs.set("key", apiKey);
  }
  return `https://image.pollinations.ai/prompt/${encoded}?${qs.toString()}`;
}

function resolveFilename(entry: WordRow, index: number): string {
  const img = typeof entry.image === "string" ? entry.image.trim() : "";
  if (img.includes("/")) {
    const base = path.basename(img);
    if (base && base !== img) return base;
  }
  return `word-${index + 1}.png`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPollinationsImageOnce(
  url: string,
  apiKey: string | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return fetch(url, { redirect: "follow", headers });
}

async function bodyPreview(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return text.slice(0, 400);
}

/**
 * 503/500: wait 30s, retry up to 3 times (3 retries after first failure → 4 attempts max for that status).
 * 429: wait 60s, retry up to 3 times.
 * Other HTTP: no retry (throws).
 */
async function fetchPollinationsImage(prompt: string, apiKey?: string): Promise<Buffer> {
  const url = buildPollinationsUrl(prompt, apiKey);
  let retries503 = 0;
  let retries429 = 0;
  const max503 = 3;
  const max429 = 3;

  for (;;) {
    const res = await fetchPollinationsImageOnce(url, apiKey);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 512) {
        throw new Error(`Pollinations: response too small (${buf.length} bytes), likely not an image`);
      }
      return buf;
    }

    const status = res.status;
    const preview = await bodyPreview(res);

    if (status === 503 || status === 500) {
      if (retries503 < max503) {
        retries503++;
        console.warn(`  HTTP ${status}: waiting 30s then retry ${retries503}/${max503}...`);
        await sleep(30_000);
        continue;
      }
      throw new Error(`Pollinations HTTP ${status} (after ${max503} retries): ${preview}`);
    }

    if (status === 429) {
      if (retries429 < max429) {
        retries429++;
        console.warn(`  HTTP 429: waiting 60s then retry ${retries429}/${max429}...`);
        await sleep(60_000);
        continue;
      }
      throw new Error(`Pollinations HTTP 429 (after ${max429} retries): ${preview}`);
    }

    throw new Error(`Pollinations HTTP ${status}: ${preview}`);
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");

  const apiKey = process.env.POLLINATIONS_API_KEY?.trim() || undefined;
  const delayMs = apiKey ? DELAY_MS_AUTH : DELAY_MS_ANON;

  if (apiKey) {
    console.log("Pollinations: authenticated (POLLINATIONS_API_KEY set). Inter-request delay 6s.");
  } else {
    console.log(
      "Pollinations: anonymous fallback (no POLLINATIONS_API_KEY). Inter-request delay 16s.",
    );
  }

  const wordsPath = path.join(ROOT, "src", "data", "words.json");
  const outDir = path.join(ROOT, "public", "images");
  mkdirSync(outDir, { recursive: true });

  const words = JSON.parse(readFileSync(wordsPath, "utf8")) as WordRow[];
  const total = words.length;
  let generated = 0;
  let failed = 0;
  let skipped = 0;
  let wordsDirty = false;

  for (let i = 0; i < words.length; i++) {
    const entry = words[i]!;
    const filename = resolveFilename(entry, i);
    const dest = path.join(outDir, filename);
    const n = i + 1;
    let shouldDelay = false;

    if (!force && existsSync(dest)) {
      console.log(`[${n}/${total}] Skipped (exists): ${entry.word} → ${filename}`);
      skipped++;
      const nextImage = `/images/${filename}`;
      if (entry.image !== nextImage) {
        entry.image = nextImage;
        wordsDirty = true;
      }
      continue;
    }

    console.log(`[${n}/${total}] Generating: ${entry.word}...`);
    shouldDelay = true;
    try {
      const prompt = buildFullPrompt(String(entry.imagePrompt ?? ""));
      const buf = await fetchPollinationsImage(prompt, apiKey);
      writeFileSync(dest, buf);
      const publicPath = `/images/${filename}`;
      if (entry.image !== publicPath) {
        entry.image = publicPath;
        wordsDirty = true;
      }
      console.log(`✅ Saved: ${filename}`);
      generated++;
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`❌ Failed (${entry.word}): ${msg}`);
    }

    if (shouldDelay && i < words.length - 1) {
      await sleep(delayMs);
    }
  }

  if (wordsDirty) {
    writeFileSync(wordsPath, `${JSON.stringify(words, null, 2)}\n`, "utf8");
    console.log("");
    console.log(`Updated ${path.relative(ROOT, wordsPath)} (image paths synced).`);
  }

  console.log("");
  console.log(`Generated: ${generated}, Failed: ${failed}, Skipped: ${skipped}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
