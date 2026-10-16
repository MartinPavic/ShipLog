import { ImageResponse } from "next/og";
import { siteConfig } from "@/config/site";

export const alt = siteConfig.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  const { name, tagline, taglineMuted, brand } = siteConfig;
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
          background: brand.primary ?? "#171717",
          color: brand.primaryForeground ?? "#fafafa",
        }}
      >
        <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 40 }}>{name}</div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1 }}>{tagline}</div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1, opacity: 0.65 }}>{taglineMuted}</div>
      </div>
    ),
    size
  );
}
