import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "TaxSnap — Snap receipts, sort your tax write-offs";

// Generic, site-wide Open Graph image - Next applies the nearest
// opengraph-image to any route that doesn't define its own, so every
// marketing page gets a real OG image without per-page art. Same
// fs.readFileSync + ImageResponse pattern as icon.tsx; default system
// font rather than loading Barlow Semi Condensed to keep this simple.
export default function OpengraphImage() {
  const logo = readFileSync(join(process.cwd(), "public", "logo-mark.png")).toString(
    "base64",
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          background: "#faf6ef",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/png;base64,${logo}`} width={120} height={120} alt="" />
        <div
          style={{
            display: "flex",
            fontSize: 72,
            fontWeight: 800,
            color: "#211d18",
          }}
        >
          TaxSnap
        </div>
        <div style={{ display: "flex", fontSize: 32, color: "#c2410c" }}>
          Snap receipts, sort your tax write-offs
        </div>
      </div>
    ),
    { ...size },
  );
}
