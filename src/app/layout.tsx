import type { Metadata } from "next";
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
    "Learning mode for beginners: read English meaning and examples, then spell the Korean word in Hangul in six tries (UTC). English UI.",
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
      </body>
    </html>
  );
}
