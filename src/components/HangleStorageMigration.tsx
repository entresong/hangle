"use client";

import { useLayoutEffect } from "react";
import { runHangleStorageMigration } from "@/lib/hangleVersion";

/** Session flag so `Game` can show a one-time toast after schema migration. */
export const HANGLE_MIGRATION_TOAST_KEY = "hangle_migration_notice_v3";

/**
 * Runs before paint. If storage was migrated, set a one-shot session flag and reload so
 * `Game` never hydrates from stale in-memory assumptions vs cleared localStorage.
 */
export function HangleStorageMigration() {
  useLayoutEffect(() => {
    const result = runHangleStorageMigration();
    if (result === "migrated") {
      try {
        window.sessionStorage.setItem(HANGLE_MIGRATION_TOAST_KEY, "1");
      } catch {
        /* ignore */
      }
      window.location.reload();
    }
  }, []);
  return null;
}
