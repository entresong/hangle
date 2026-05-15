"use client";

import { useLayoutEffect } from "react";
import { runHangleStorageMigration } from "@/lib/hangleVersion";

/** Session flag so `Game` can show a one-time toast after schema migration. */
export const HANGLE_MIGRATION_TOAST_KEY = "hangle_migration_notice_v3";

/**
 * Runs before paint so `localStorage` matches `CURRENT_VERSION` before any game code reads keys.
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
    }
  }, []);
  return null;
}
