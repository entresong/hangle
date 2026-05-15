/**
 * Client-side storage schema version. Bump when persisted shapes change incompatibly
 * (e.g. hearts + sequential paid hints) so legacy localStorage is cleared once.
 */
export const CURRENT_VERSION = "v3_sequential_hints";

export const HANGLE_VERSION_KEY = "hangle_version";

export type HangleMigrationResult = "new" | "migrated" | "same";

function listHangleLocalStorageKeys(): string[] {
  if (typeof window === "undefined") return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k != null && k.startsWith("hangle")) out.push(k);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function clearAllHangleLocalStorageKeys(): void {
  if (typeof window === "undefined") return;
  const keys = listHangleLocalStorageKeys();
  for (const k of keys) {
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

function writeCurrentVersion(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HANGLE_VERSION_KEY, CURRENT_VERSION);
  } catch {
    /* ignore */
  }
}

/**
 * Run once early on the client before reading game/hearts/hint keys.
 *
 * - `same`: already on CURRENT_VERSION — no-op.
 * - `new`: no version and no prior `hangle*` keys — first visit; stamp version only.
 * - `migrated`: wrong/missing version with existing `hangle*` data, or stale version string —
 *   clears every `localStorage` key whose name starts with `hangle`, then stamps version.
 */
export function runHangleStorageMigration(): HangleMigrationResult {
  if (typeof window === "undefined") return "same";

  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(HANGLE_VERSION_KEY);
  } catch {
    return "same";
  }

  if (stored === CURRENT_VERSION) {
    return "same";
  }

  const keys = listHangleLocalStorageKeys();
  const keysOtherThanVersion = keys.filter((k) => k !== HANGLE_VERSION_KEY);

  if (stored === null && keysOtherThanVersion.length === 0) {
    writeCurrentVersion();
    return "new";
  }

  clearAllHangleLocalStorageKeys();
  writeCurrentVersion();
  return "migrated";
}
