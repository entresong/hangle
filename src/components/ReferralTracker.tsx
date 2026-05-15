"use client";

import { useEffect, useRef } from "react";
import { hangleTrack } from "@/lib/hangleTrack";

/**
 * Fire once per browser session when landing with UTM (share campaign).
 */
export function ReferralTracker() {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    if (typeof window === "undefined") return;
    try {
      const sp = new URLSearchParams(window.location.search);
      const utmSource = sp.get("utm_source");
      if (!utmSource) return;
      fired.current = true;
      hangleTrack("referral_visit", {
        utm_source: utmSource,
        utm_content: sp.get("utm_content") ?? "",
      });
    } catch {
      /* ignore */
    }
  }, []);
  return null;
}
