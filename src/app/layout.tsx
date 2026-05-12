import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { DM_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hangle — Korean spelling practice",
  description:
    "Daily Korean word + phrase. Learn through play: spell a 2-syllable word in Hangul in six tries (UTC), then study a standard greeting or phrase. English UI.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-[100dvh] max-h-[100dvh]">
      <body
        className={`${serif.variable} ${sans.variable} flex h-full min-h-0 flex-col overflow-hidden overscroll-none bg-[#fafaf9] font-sans antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
