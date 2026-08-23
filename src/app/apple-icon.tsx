import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
        }}
      >
        <svg width="102" height="102" viewBox="0 0 24 24" fill="none">
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
    { ...size },
  );
}
