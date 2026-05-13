/**
 * Fetch Microsoft Clarity "Project Live Insights" data.
 *
 * Docs: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api
 *
 * Usage (PowerShell / bash, with .env.local autoload):
 *   node scripts/fetchClarityData.js
 *
 * Usage (with one-off token, no .env.local):
 *   CLARITY_API_TOKEN=eyJ... node scripts/fetchClarityData.js
 *
 * Optional flags via env vars (all optional):
 *   CLARITY_NUM_DAYS=1|2|3      (default: 3)
 *   CLARITY_DIM1=Country        (default: Country)
 *   CLARITY_DIM2=Device         (default: Device)
 *   CLARITY_DIM3=Browser        (default: Browser)
 *
 * Notes:
 * - Requires Node 18+ (native fetch). This repo runs Node 22+.
 * - Free tier limit: ~10 API requests per project per day.
 * - Output: ./clarity-data.json (latest) + ./clarity-data-<timestamp>.json (history).
 *   Both are gitignored.
 */

const fs = require("fs");
const path = require("path");

try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
} catch {
  // dotenv missing is fine — env vars may be supplied inline
}

const CLARITY_API_TOKEN = process.env.CLARITY_API_TOKEN;
const ENDPOINT =
  "https://www.clarity.ms/export-data/api/v1/project-live-insights";

const NUM_DAYS = process.env.CLARITY_NUM_DAYS || "3";
const DIM1 = process.env.CLARITY_DIM1 || "Country";
const DIM2 = process.env.CLARITY_DIM2 || "Device";
const DIM3 = process.env.CLARITY_DIM3 || "Browser";

const VALID_NUM_DAYS = new Set(["1", "2", "3"]);

function maskToken(t) {
  if (!t || t.length < 16) return "<missing>";
  return `${t.slice(0, 8)}…${t.slice(-6)}`;
}

function bytesHuman(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function summarize(data) {
  if (!Array.isArray(data)) {
    console.log("(unexpected payload shape — printing raw above)");
    return;
  }
  console.log(`\n── Summary · ${data.length} metric blocks ──`);
  for (const block of data) {
    const name = block?.metricName || "(unnamed metric)";
    const rows = Array.isArray(block?.information) ? block.information : [];
    console.log(`\n• ${name}  [${rows.length} rows]`);
    rows.slice(0, 5).forEach((row, i) => {
      const compact = Object.entries(row)
        .map(([k, v]) => `${k}=${v}`)
        .join("  ");
      console.log(`   ${i + 1}. ${compact}`);
    });
    if (rows.length > 5) {
      console.log(`   … (${rows.length - 5} more rows in JSON file)`);
    }
  }
}

async function fetchClarityInsights() {
  if (!CLARITY_API_TOKEN) {
    console.error(
      "✗ CLARITY_API_TOKEN missing.\n" +
        "  Set it in .env.local or inline:\n" +
        "  CLARITY_API_TOKEN=eyJ... node scripts/fetchClarityData.js",
    );
    process.exit(1);
  }

  if (!VALID_NUM_DAYS.has(String(NUM_DAYS))) {
    console.error(
      `✗ CLARITY_NUM_DAYS must be 1, 2, or 3 (got "${NUM_DAYS}").`,
    );
    process.exit(1);
  }

  const params = new URLSearchParams({
    numOfDays: String(NUM_DAYS),
    dimension1: DIM1,
    dimension2: DIM2,
    dimension3: DIM3,
  });
  const url = `${ENDPOINT}?${params.toString()}`;

  console.log("→ Clarity Data Export API");
  console.log(`  endpoint    : ${ENDPOINT}`);
  console.log(`  numOfDays   : ${NUM_DAYS}`);
  console.log(`  dimensions  : ${DIM1}, ${DIM2}, ${DIM3}`);
  console.log(`  token       : ${maskToken(CLARITY_API_TOKEN)}`);

  const started = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${CLARITY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("✗ Network error:", err?.message || err);
    process.exit(1);
  }

  const elapsedMs = Date.now() - started;
  console.log(`  status      : ${response.status} ${response.statusText} (${elapsedMs}ms)`);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(`✗ API error: ${response.status} ${response.statusText}`);
    if (errorText) console.error("  body:", errorText.slice(0, 800));
    if (response.status === 401 || response.status === 403) {
      console.error(
        "  Hint: token may be expired or missing the Data.Export scope. " +
          "Regenerate at https://clarity.microsoft.com (Settings → Data Export).",
      );
    }
    if (response.status === 429) {
      console.error(
        "  Hint: rate limit hit (free tier = ~10 requests/project/day). Wait and retry tomorrow.",
      );
    }
    process.exit(1);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    console.error("✗ Failed to parse JSON:", err?.message || err);
    process.exit(1);
  }

  const json = JSON.stringify(data, null, 2);

  const projectRoot = path.join(__dirname, "..");
  const latestPath = path.join(projectRoot, "clarity-data.json");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const historyPath = path.join(projectRoot, `clarity-data-${stamp}.json`);

  fs.writeFileSync(latestPath, json);
  fs.writeFileSync(historyPath, json);

  console.log("\n=== Clarity raw payload ===");
  console.log(json);

  summarize(data);

  console.log("\n✓ Saved:");
  console.log(`   ${path.relative(projectRoot, latestPath)}  (latest, ${bytesHuman(Buffer.byteLength(json))})`);
  console.log(`   ${path.relative(projectRoot, historyPath)}  (timestamped history)`);
}

fetchClarityInsights();
