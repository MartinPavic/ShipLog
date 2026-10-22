import { ImageResponse } from "next/og";
import { siteConfig } from "@/config/site";

export const alt = siteConfig.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NAVY = "#1c2a44";
const PARCHMENT = "#f3ead6";
const BRASS = "#d4a64a";

export default function OpengraphImage() {
  const { name, tagline, taglineMuted, brand } = siteConfig;
  const background = brand.primary ?? NAVY;
  const color = brand.primaryForeground ?? PARCHMENT;
  const accent = brand.primary ? color : BRASS;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 96,
          background,
          color,
          border: `6px solid ${accent}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 40, fontSize: 48, fontWeight: 700, color: accent }}>
          <svg width="64" height="64" viewBox="0 0 32 32" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round">
            <circle cx="16" cy="16" r="8" />
            <circle cx="16" cy="16" r="2.5" fill={accent} stroke="none" />
            <path d="M16 3v10.5M16 18.5V29M3 16h10.5M18.5 16H29M6.8 6.8l7.4 7.4M17.8 17.8l7.4 7.4M25.2 6.8l-7.4 7.4M14.2 17.8l-7.4 7.4" />
          </svg>
          {name}
        </div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1 }}>{tagline}</div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1, opacity: 0.65 }}>{taglineMuted}</div>
      </div>
    ),
    size
  );
}
