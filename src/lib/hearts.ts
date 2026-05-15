/** localStorage key for hearts economy */
export const HEARTS_STORAGE_KEY = "hangle_hearts";

export type HeartsState = {
  current: number;
  /** Local calendar YYYY-MM-DD when `current` was last reset to 3 */
  lastReset: string;
};

function localYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function defaultHearts(): HeartsState {
  const today = localYmd();
  return { current: 3, lastReset: today };
}

/** Load + apply daily reset (local midnight boundary = local calendar day). */
export function loadHearts(): HeartsState {
  const today = localYmd();
  if (typeof window === "undefined") return defaultHearts();
  try {
    const raw = localStorage.getItem(HEARTS_STORAGE_KEY);
    if (!raw) {
      const s = defaultHearts();
      localStorage.setItem(HEARTS_STORAGE_KEY, JSON.stringify(s));
      return s;
    }
    const parsed = JSON.parse(raw) as Partial<HeartsState>;
    const lastReset = typeof parsed.lastReset === "string" ? parsed.lastReset : today;
    let current = Math.min(3, Math.max(0, Number(parsed.current) || 0));
    if (lastReset !== today) {
      current = 3;
      const next: HeartsState = { current: 3, lastReset: today };
      localStorage.setItem(HEARTS_STORAGE_KEY, JSON.stringify(next));
      return next;
    }
    return { current, lastReset: today };
  } catch {
    return defaultHearts();
  }
}

export function saveHearts(state: HeartsState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(HEARTS_STORAGE_KEY, JSON.stringify(state));
}

export function spendHeart(prev: HeartsState): HeartsState | null {
  if (prev.current <= 0) return null;
  const next = { ...prev, current: prev.current - 1 };
  saveHearts(next);
  return next;
}

export function refillHeartsFull(): HeartsState {
  const today = localYmd();
  const next: HeartsState = { current: 3, lastReset: today };
  saveHearts(next);
  return next;
}
