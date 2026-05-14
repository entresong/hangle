/**
 * LoL-inspired rank tiers by distinct words learned (honest, localStorage-driven).
 */

export type RankInfo = {
  name: string;
  icon: string;
  /** Hex for accents (header pill, stats) */
  color: string;
  /** Minimum words for this tier */
  min: number;
  /** Minimum words for the *next* tier, or null if Grand Master */
  nextMin: number | null;
  /** Words still needed to enter the next tier */
  wordsToNext: number;
  /** Progress 0–100 from this tier's floor toward the next tier's floor */
  progressInTierPercent: number;
};

const TIERS: readonly { min: number; name: string; icon: string; color: string }[] = [
  { min: 0, name: "Bronze", icon: "🥉", color: "#cd7f32" },
  { min: 10, name: "Silver", icon: "🥈", color: "#c0c0c0" },
  { min: 25, name: "Gold", icon: "🥇", color: "#ffd700" },
  { min: 50, name: "Platinum", icon: "💎", color: "#00ced1" },
  { min: 100, name: "Diamond", icon: "💎", color: "#b9f2ff" },
  { min: 200, name: "Master", icon: "👑", color: "#9d4edd" },
  { min: 500, name: "Grand Master", icon: "🏆", color: "#f72585" },
];

export function getRankProgress(wordsLearned: number): RankInfo {
  const n = Math.max(0, Math.floor(wordsLearned));
  let idx = 0;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (n >= TIERS[i]!.min) {
      idx = i;
      break;
    }
  }
  const cur = TIERS[idx]!;
  const nextTier = TIERS[idx + 1] ?? null;
  const nextMin = nextTier?.min ?? null;
  const wordsToNext = nextMin === null ? 0 : Math.max(0, nextMin - n);
  const span = nextMin === null ? 1 : nextMin - cur.min;
  const into = n - cur.min;
  const progressInTierPercent =
    nextMin === null ? 100 : Math.min(100, Math.round((into / Math.max(1, span)) * 100));

  return {
    name: cur.name,
    icon: cur.icon,
    color: cur.color,
    min: cur.min,
    nextMin,
    wordsToNext,
    progressInTierPercent,
  };
}

export function getRank(wordsLearned: number): Pick<RankInfo, "name" | "icon" | "color"> {
  const { name, icon, color } = getRankProgress(wordsLearned);
  return { name, icon, color };
}

/** Nexus / collection goal — matches “100 Korean words” product copy. */
export const NEXUS_WORD_GOAL = 100;

export function nexusWordsLearned(count: number): number {
  return Math.min(Math.max(0, count), NEXUS_WORD_GOAL);
}

export function nexusProgressPercent(count: number): number {
  return Math.round((nexusWordsLearned(count) / NEXUS_WORD_GOAL) * 100);
}
