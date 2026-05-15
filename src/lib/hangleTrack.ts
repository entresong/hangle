import { track } from "@vercel/analytics";

type Props = Record<string, string | number | boolean | null | undefined>;

export function hangleTrack(name: string, data?: Props): void {
  try {
    if (typeof window === "undefined") return;
    track(name, data);
  } catch {
    /* ignore analytics failures */
  }
}
