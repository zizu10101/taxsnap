import { readFileSync } from "fs";
import { join } from "path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          alignItems: "center",
          justifyContent: "center",
          background: "#faf6ef",
          borderRadius: 7,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:image/png;base64,${logo}`}
          width={24}
          height={24}
          alt=""
        />
      </div>
    ),
    { ...size },
  );
}
