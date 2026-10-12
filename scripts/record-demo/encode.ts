/**
 * Encodes the demo recordings for the website.
 *
 * For each .webm in scripts/record-demo/out/ this writes, into public/videos/:
 *   <name>.mp4  H.264, yuv420p, +faststart, no audio, crf 24, 780px wide, 30fps
 *   <name>.jpg  a poster frame taken at ~1.5s (from the same cropped/scaled picture)
 *
 * Older recordings were made on a 780x1688 canvas with the 390x844 page in its
 * top-left corner and grey padding around it; any source larger than 390x844 is
 * cropped to that top-left region first.
 *
 * Needs ffmpeg and ffprobe on the PATH. Run:  npm run videos:encode
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const IN_DIR = path.join(HERE, "out");
const OUT_DIR = path.join(HERE, "..", "..", "public", "videos");
const MAX_MP4_BYTES = 3 * 1024 * 1024;
const PAGE_W = 390;
const PAGE_H = 844;
const SCALE = "scale=780:-2:flags=lanczos";

if (
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0 ||
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status !== 0
) {
  console.error(
    "ffmpeg/ffprobe was not found. Install it (e.g. `winget install Gyan.FFmpeg`), reopen the terminal, and run again.",
  );
  process.exit(1);
}

const inputs = fs.existsSync(IN_DIR)
  ? fs.readdirSync(IN_DIR).filter((f) => f.endsWith(".webm"))
  : [];
if (inputs.length === 0) {
  console.error(`No .webm files in ${IN_DIR}. Run the record:demo scripts first.`);
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

function ffmpeg(args: string[]) {
  const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`ffmpeg failed: ffmpeg ${args.join(" ")}`);
    process.exit(1);
  }
}

function sourceSize(file: string): { width: number; height: number } {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file],
    { encoding: "utf8" },
  );
  const [width, height] = probe.stdout.trim().split("x").map(Number);
  if (probe.status !== 0 || !width || !height) {
    console.error(`ffprobe could not read the size of ${file}.`);
    process.exit(1);
  }
  return { width, height };
}

const kb = (file: string) => `${(fs.statSync(file).size / 1024).toFixed(0)} KB`;

for (const input of inputs) {
  const name = path.basename(input, ".webm");
  const src = path.join(IN_DIR, input);
  const mp4 = path.join(OUT_DIR, `${name}.mp4`);
  const poster = path.join(OUT_DIR, `${name}.jpg`);

  const { width, height } = sourceSize(src);
  const padded = width > PAGE_W || height > PAGE_H;
  // Old padded recordings: keep only the top-left page region, then scale up.
  const filters = padded ? `crop=${PAGE_W}:${PAGE_H}:0:0,${SCALE}` : SCALE;
  if (padded) console.log(`${name}: source is ${width}x${height}, cropping to ${PAGE_W}x${PAGE_H}`);

  ffmpeg([
    "-i", src,
    "-an",
    "-vf", `${filters},fps=30`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-crf", "24",
    "-preset", "slow",
    "-movflags", "+faststart",
    mp4,
  ]);
  ffmpeg(["-ss", "1.5", "-i", src, "-frames:v", "1", "-vf", filters, "-q:v", "3", poster]);

  console.log(`${name}: mp4 ${kb(mp4)}, poster ${kb(poster)}`);
  if (fs.statSync(mp4).size > MAX_MP4_BYTES) {
    console.warn(`  WARNING: ${name}.mp4 is over 3 MB. Trim the recording or raise the crf.`);
  }
}
