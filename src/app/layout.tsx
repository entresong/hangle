import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import { DM_Sans, Source_Serif_4 } from "next/font/google";
import Script from "next/script";
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

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ||
  "https://hangle-three.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(`${siteUrl}/`),
  title: "Hangle — Korean Wordle",
  description:
    "Daily Korean word game for K-pop & K-drama fans: spell Hangul in six tries (UTC), with hints and bonus phrases. English UI.",
  openGraph: {
    title: "Hangle — Korean Wordle",
    description:
      "Daily Korean word game for K-pop & K-drama fans — learn Korean through play.",
    url: "/",
    siteName: "Hangle",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Hangle — Korean Wordle",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Hangle — Korean Wordle",
    description: "Daily Korean word game — learn Korean through play.",
    images: ["/opengraph-image"],
  },
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
  const clarityId = process.env.NEXT_PUBLIC_CLARITY_ID;
  return (
    <html lang="en" className="h-[100dvh] max-h-[100dvh]">
      <body
        className={`${serif.variable} ${sans.variable} flex h-full min-h-0 flex-col overflow-hidden overscroll-none bg-[#fafaf9] font-sans antialiased`}
      >
        {children}
        <Analytics />
        {clarityId && (
          <Script
            id="clarity-script"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                (function(c,l,a,r,i,t,y){
                  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
                })(window, document, "clarity", "script", "${clarityId}");
              `,
            }}
          />
        )}
      </body>
    </html>
  );
}
