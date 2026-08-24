import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#C2410C",
          borderRadius: 40,
        }}
      >
        <svg width="110" height="110" viewBox="0 0 24 24" fill="none">
          <path
            d="M9 2h6l1 3h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2l1-3Z"
            stroke="#f8fafc"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="13" r="4" stroke="#f8fafc" strokeWidth="1.6" />
        </svg>
      </div>
    ),
    { width: 192, height: 192 },
  );
}
