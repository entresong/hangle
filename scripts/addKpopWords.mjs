/**
 * One-shot data update:
 *  1. Append 20 K-pop-flavored 2-syllable words to src/data/words.json
 *  2. Tag existing K-pop-flavored entries with `tags: ["K-POP"]`
 *
 * Run with: `node scripts/addKpopWords.mjs`
 *
 * Safe to re-run: idempotent — skips appends if the word already exists,
 * and only adds the tag if missing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORDS_PATH = path.join(__dirname, "..", "src", "data", "words.json");

const K_TAG = "K-POP";

/** Words ALREADY in the file that should gain a K-POP tag */
const EXISTING_TO_TAG = [
  "사랑",
  "마음",
  "영원",
  "추억",
  "청춘",
  "새벽",
  "약속",
  "위로",
  "이별",
  "진심",
  "봄날",
  "운명",
];

/**
 * New entries. Every word is:
 *  - 2 Hangul syllables (length === 2)
 *  - a standard Korean noun (not an adjective stem or particle phrase)
 *  - tagged K-POP
 *  - 3 natural usage examples using the allowed context values:
 *      "K-drama" | "K-pop" | "Daily" | "Formal" | "Casual"
 *
 * No song titles, lyrics, or artist names are quoted (copyright-safe).
 */
const NEW_WORDS = [
  {
    word: "눈물",
    length: 2,
    meaning: "tears",
    definition: "Drops that come from the eyes when crying.",
    emoji: "💧",
    category: "EMOTION",
    imagePrompt: "single teardrop on a cheek",
    examples: [
      { korean: "눈물이 났어", english: "Tears welled up", context: "Casual" },
      { korean: "눈물을 닦았다", english: "I wiped my tears", context: "Daily" },
      { korean: "눈물 흘리지 마", english: "Don't shed tears", context: "K-drama" },
    ],
    tags: [K_TAG],
  },
  {
    word: "상처",
    length: 2,
    meaning: "wound / hurt",
    definition: "An emotional or physical hurt.",
    emoji: "🩹",
    category: "EMOTION",
    imagePrompt: "a small bandage on skin",
    examples: [
      { korean: "마음에 상처 받았어", english: "My heart was hurt", context: "K-drama" },
      { korean: "상처가 아물었다", english: "The wound healed", context: "Daily" },
      { korean: "깊은 상처를 남겼다", english: "It left a deep wound", context: "Formal" },
    ],
    tags: [K_TAG],
  },
  {
    word: "별빛",
    length: 2,
    meaning: "starlight",
    definition: "The light coming from stars.",
    emoji: "✨",
    category: "NATURE",
    imagePrompt: "tiny stars glowing in a dark sky",
    examples: [
      { korean: "별빛이 빛나", english: "The starlight shines", context: "K-pop" },
      { korean: "별빛 아래 걸었어", english: "We walked under the stars", context: "K-drama" },
      { korean: "밤하늘에 별빛이 가득해", english: "The night sky is full of starlight", context: "Daily" },
    ],
    tags: [K_TAG],
  },
  {
    word: "달빛",
    length: 2,
    meaning: "moonlight",
    definition: "Light from the moon.",
    emoji: "🌙",
    category: "NATURE",
    imagePrompt: "moonlight reflecting on water",
    examples: [
      { korean: "달빛이 환해", english: "The moonlight is bright", context: "Casual" },
      { korean: "달빛이 비치는 호수", english: "A lake lit by moonlight", context: "Formal" },
      { korean: "달빛 아래서 만났어", english: "We met under the moonlight", context: "K-drama" },
    ],
    tags: [K_TAG],
  },
  {
    word: "인연",
    length: 2,
    meaning: "fated bond",
    definition: "A connection between people that feels destined.",
    emoji: "🔗",
    category: "CONCEPT",
    imagePrompt: "two threads tied together",
    examples: [
      { korean: "우린 인연이야", english: "We are fated", context: "K-drama" },
      { korean: "좋은 인연이 되길", english: "May we be a good connection", context: "Formal" },
      { korean: "인연이 닿았어", english: "Our paths crossed", context: "Casual" },
    ],
    tags: [K_TAG],
  },
  {
    word: "거짓",
    length: 2,
    meaning: "lie / falsehood",
    definition: "Something that is not true.",
    emoji: "🚫",
    category: "CONCEPT",
    imagePrompt: "a long nose silhouette",
    examples: [
      { korean: "거짓 없이 말해", english: "Tell me without lies", context: "Casual" },
      { korean: "거짓과 진실 사이", english: "Between lie and truth", context: "Formal" },
      { korean: "그건 거짓이 아니야", english: "That isn't a lie", context: "Daily" },
    ],
    tags: [K_TAG],
  },
  {
    word: "만남",
    length: 2,
    meaning: "meeting / encounter",
    definition: "The moment of meeting someone.",
    emoji: "🤝",
    category: "CONCEPT",
    imagePrompt: "two people meeting on a street",
    examples: [
      { korean: "첫 만남이었어", english: "It was our first meeting", context: "Daily" },
      { korean: "만남은 짧았다", english: "The meeting was short", context: "Formal" },
      { korean: "운명적인 만남", english: "A fateful encounter", context: "K-drama" },
    ],
    tags: [K_TAG],
  },
  {
    word: "그날",
    length: 2,
    meaning: "that day",
    definition: "A specific day, often remembered.",
    emoji: "📅",
    category: "TIME",
    imagePrompt: "a single highlighted day on a calendar",
    examples: [
      { korean: "그날을 잊을 수 없어", english: "I can't forget that day", context: "K-drama" },
      { korean: "그날 비가 왔어", english: "It rained that day", context: "Daily" },
      { korean: "그날 이후로 변했어", english: "I've changed since that day", context: "Casual" },
    ],
    tags: [K_TAG],
  },
  {
    word: "우리",
    length: 2,
    meaning: "we / us",
    definition: "We, the speaker plus others (also used like 'our').",
    emoji: "👫",
    category: "PERSON",
    imagePrompt: "two friends shoulder to shoulder",
    examples: [
      { korean: "우리 같이 가자", english: "Let's go together", context: "Casual" },
      { korean: "우리 사이에", english: "Between us", context: "K-drama" },
      { korean: "우리 가족이야", english: "We're family", context: "Daily" },
    ],
    tags: [K_TAG],
  },
  {
    word: "그대",
    length: 2,
    meaning: "you (poetic)",
    definition: "A poetic or formal way to say 'you'.",
    emoji: "💌",
    category: "PERSON",
    imagePrompt: "a love letter on a wooden desk",
    examples: [
      { korean: "그대를 사랑해", english: "I love you", context: "K-pop" },
      { korean: "그대 곁에 있을게", english: "I'll stay by your side", context: "K-drama" },
      { korean: "그대는 누구신가요", english: "Who are you?", context: "Formal" },
    ],
    tags: [K_TAG],
  },
  {
    word: "하루",
    length: 2,
    meaning: "one day",
    definition: "A single 24-hour day.",
    emoji: "🌅",
    category: "TIME",
    imagePrompt: "sunrise over a quiet field",
    examples: [
      { korean: "하루가 빨라", english: "A day passes so fast", context: "Casual" },
      { korean: "하루 종일 비가 왔어", english: "It rained all day", context: "Daily" },
      { korean: "하루만 더 기다려", english: "Just wait one more day", context: "K-drama" },
    ],
    tags: [K_TAG],
  },
  {
    word: "향기",
    length: 2,
    meaning: "fragrance",
    definition: "A pleasant smell from flowers or perfume.",
    emoji: "🌷",
    category: "NATURE",
    imagePrompt: "a tulip with soft light",
    examples: [
      { korean: "향기가 좋네", english: "The fragrance is nice", context: "Casual" },
      { korean: "꽃향기가 났어", english: "A floral fragrance drifted by", context: "Daily" },
      { korean: "너의 향기를 기억해", english: "I remember your scent", context: "K-pop" },
    ],
    tags: [K_TAG],
  },
  {
    word: "흔적",
    length: 2,
    meaning: "trace / vestige",
    definition: "A mark left behind by someone or something.",
    emoji: "👣",
    category: "CONCEPT",
    imagePrompt: "footprints in soft sand",
    examples: [
      { korean: "흔적이 남았어", english: "A trace remained", context: "Daily" },
      { korean: "너의 흔적을 따라", english: "Following your trace", context: "K-pop" },
      { korean: "흔적을 지웠다", english: "I erased the traces", context: "Formal" },
    ],
    tags: [K_TAG],
  },
  {
    word: "후회",
    length: 2,
    meaning: "regret",
    definition: "A feeling of sorrow about a past choice.",
    emoji: "😔",
    category: "EMOTION",
    imagePrompt: "a person looking down thoughtfully",
    examples: [
      { korean: "후회가 남아", english: "Regret lingers", context: "K-drama" },
      { korean: "후회는 없어", english: "I have no regrets", context: "Casual" },
      { korean: "후회하지 않을 거야", english: "I won't regret it", context: "Daily" },
    ],
    tags: [K_TAG],
  },
  {
    word: "손길",
    length: 2,
    meaning: "caring touch",
    definition: "A gentle, caring reach of a hand.",
    emoji: "🤲",
    category: "CONCEPT",
    imagePrompt: "two open hands held out together",
    examples: [
      { korean: "따뜻한 손길", english: "A warm touch", context: "K-pop" },
      { korean: "손길이 닿았다", english: "A hand reached out", context: "Daily" },
      { korean: "너의 손길이 그리워", english: "I miss your touch", context: "K-drama" },
    ],
    tags: [K_TAG],
  },
  {
    word: "빗물",
    length: 2,
    meaning: "rainwater",
    definition: "Water that falls as rain.",
    emoji: "🌧️",
    category: "NATURE",
    imagePrompt: "raindrops sliding down a window",
    examples: [
      { korean: "빗물에 젖었다", english: "I got soaked by the rain", context: "Daily" },
      { korean: "빗물 소리가 좋아", english: "I like the sound of rain", context: "Casual" },
      { korean: "빗물에 눈물을 숨겼어", english: "I hid my tears in the rain", context: "K-drama" },
    ],
    tags: [K_TAG],
  },
  {
    word: "파도",
    length: 2,
    meaning: "wave",
    definition: "A moving ridge of water on the sea.",
    emoji: "🌊",
    category: "NATURE",
    imagePrompt: "ocean wave curling on a beach",
    examples: [
      { korean: "파도가 세", english: "The waves are strong", context: "Casual" },
      { korean: "파도 소리를 들었어", english: "I heard the sound of waves", context: "Daily" },
      { korean: "파도처럼 다가왔어", english: "It came like a wave", context: "K-pop" },
    ],
    tags: [K_TAG],
  },
  {
    word: "꽃잎",
    length: 2,
    meaning: "petal",
    definition: "A soft colored part of a flower.",
    emoji: "🌸",
    category: "NATURE",
    imagePrompt: "single cherry blossom petal floating",
    examples: [
      { korean: "꽃잎이 떨어졌어", english: "A petal fell", context: "Casual" },
      { korean: "봄이 와서 꽃잎이 흩날려", english: "Petals scatter as spring arrives", context: "K-drama" },
      { korean: "꽃잎을 모았다", english: "I gathered petals", context: "Daily" },
    ],
    tags: [K_TAG],
  },
  {
    word: "첫눈",
    length: 2,
    meaning: "first snow",
    definition: "The first snowfall of the season.",
    emoji: "❄️",
    category: "NATURE",
    imagePrompt: "first snowflakes on a quiet street",
    examples: [
      { korean: "첫눈이 왔어", english: "The first snow has come", context: "Daily" },
      { korean: "첫눈 오는 날에 만나자", english: "Let's meet on the day of the first snow", context: "K-drama" },
      { korean: "첫눈을 같이 봤어", english: "We saw the first snow together", context: "Casual" },
    ],
    tags: [K_TAG],
  },
  {
    word: "한숨",
    length: 2,
    meaning: "sigh",
    definition: "A long breath out, often of weariness or relief.",
    emoji: "💨",
    category: "CONCEPT",
    imagePrompt: "soft wisp of breath in cold air",
    examples: [
      { korean: "한숨이 나와", english: "A sigh comes out", context: "Casual" },
      { korean: "깊은 한숨을 쉬었어", english: "I let out a deep sigh", context: "Daily" },
      { korean: "한숨 끝에 미소가 보였다", english: "A smile appeared after a sigh", context: "K-drama" },
    ],
    tags: [K_TAG],
  },
];

function main() {
  const raw = fs.readFileSync(WORDS_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error("words.json is not an array");
  }
  const before = data.length;
  const existingByWord = new Map(data.map((w) => [w.word, w]));

  let tagged = 0;
  for (const word of EXISTING_TO_TAG) {
    const entry = existingByWord.get(word);
    if (!entry) continue;
    const tags = new Set(entry.tags ?? []);
    if (!tags.has(K_TAG)) {
      tags.add(K_TAG);
      entry.tags = Array.from(tags);
      tagged++;
    }
  }

  let appended = 0;
  for (const w of NEW_WORDS) {
    if (existingByWord.has(w.word)) {
      console.warn(`! skip (already exists): ${w.word}`);
      continue;
    }
    data.push(w);
    appended++;
  }

  fs.writeFileSync(WORDS_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");

  console.log(`✓ words.json updated`);
  console.log(`  before: ${before} entries`);
  console.log(`  after : ${data.length} entries`);
  console.log(`  appended: ${appended} new K-POP words`);
  console.log(`  tagged existing: ${tagged} entries with K-POP`);
}

main();
