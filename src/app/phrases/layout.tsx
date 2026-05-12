import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Phrases — Hangle",
  description: "30 standard Korean greetings and useful expressions with pronunciation.",
};

export default function PhrasesLayout({ children }: { children: ReactNode }) {
  return children;
}
