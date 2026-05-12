import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Hangle — Korean Wordle";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(165deg, #faf7f0 0%, #efe8dc 45%, #e7ddd0 100%)",
          color: "#1c1917",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 800, letterSpacing: "-0.02em" }}>🇰🇷 Hangle</div>
        <div style={{ fontSize: 38, fontWeight: 600, marginTop: 28, opacity: 0.92 }}>Korean Wordle</div>
        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 36,
            fontSize: 44,
            letterSpacing: 4,
            opacity: 0.85,
          }}
        >
          <span>⬜</span>
          <span>🟨</span>
          <span>🟩</span>
          <span>⬜</span>
          <span>🟩</span>
        </div>
        <div style={{ fontSize: 28, fontWeight: 500, marginTop: 28, opacity: 0.78 }}>
          Daily Korean word · Learn through play
        </div>
      </div>
    ),
    { ...size },
  );
}
