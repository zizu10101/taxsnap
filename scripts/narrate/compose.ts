/**
 * ffmpeg side: lays a vertical phone recording on a 1920x1080 dark canvas (rounded frame, soft
 * shadow, captions in the empty space to the left) and joins scenes. Needs ffmpeg/ffprobe on PATH.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { FitPlan } from "./script.ts";

export const W = 1920;
export const H = 1080;
export const FPS = 30;

const SCREEN_H = 980; // phone screen height; 50 px of canvas above and below
const BEZEL = 12;
const SCREEN_RADIUS = 34;
const BG = "#12151a";
export const TEXT_LEFT = 90;
const TEXT_GAP = 70; // between the captions and the phone frame

export function run(cmd: string, args: string[], cwd?: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${(r.stderr || "").split("\n").slice(-12).join("\n")}`);
  return r.stdout;
}

export function requireFfmpeg() {
  for (const bin of ["ffmpeg", "ffprobe"]) {
    if (spawnSync(bin, ["-version"], { stdio: "ignore" }).status !== 0) {
      throw new Error(`${bin} was not found on the PATH. Install it with: winget install Gyan.FFmpeg (then reopen the terminal).`);
    }
  }
}

export function probe(file: string): { duration: number; width: number; height: number } {
  const out = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file]);
  const j = JSON.parse(out);
  return { duration: Number(j.format.duration), width: j.streams[0].width, height: j.streams[0].height };
}

export type Layout = {
  screenW: number;
  screenH: number;
  x: number;
  y: number;
  /** captions' right-hand margin, in canvas pixels, measured from the right edge */
  marginR: number;
};

export function layoutFor(srcW: number, srcH: number): Layout {
  const screenW = Math.round((SCREEN_H * srcW) / srcH / 2) * 2;
  const x = Math.round((W - screenW) / 2);
  const y = Math.round((H - SCREEN_H) / 2);
  return { screenW, screenH: SCREEN_H, x, y, marginR: W - (x - BEZEL - TEXT_GAP) };
}

/** Background (dark canvas + shadow + plain frame) and the rounded-corner mask for the screen. */
export async function buildAssets(dir: string, l: Layout): Promise<{ bg: string; mask: string }> {
  fs.mkdirSync(dir, { recursive: true });
  const fx = l.x - BEZEL;
  const fy = l.y - BEZEL;
  const fw = l.screenW + BEZEL * 2;
  const fh = l.screenH + BEZEL * 2;
  const r = SCREEN_RADIUS + BEZEL;
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><filter id="b" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="30"/></filter></defs>
    <rect width="${W}" height="${H}" fill="${BG}"/>
    <rect x="${fx}" y="${fy + 22}" width="${fw}" height="${fh}" rx="${r}" fill="#000" opacity="0.65" filter="url(#b)"/>
    <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="${r}" fill="#2b3139"/>
    <rect x="${l.x - 2}" y="${l.y - 2}" width="${l.screenW + 4}" height="${l.screenH + 4}" rx="${SCREEN_RADIUS + 2}" fill="#000"/>
  </svg>`;
  const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${l.screenW}" height="${l.screenH}">
    <rect width="${l.screenW}" height="${l.screenH}" fill="#000"/>
    <rect width="${l.screenW}" height="${l.screenH}" rx="${SCREEN_RADIUS}" fill="#fff"/>
  </svg>`;
  const bg = path.join(dir, "bg.png");
  const mask = path.join(dir, "mask.png");
  await sharp(Buffer.from(bgSvg)).png().toFile(bg);
  await sharp(Buffer.from(maskSvg)).greyscale().png().toFile(mask);
  return { bg, mask };
}

export type SceneRender = {
  dir: string; // holds scene.ass (burned in) and receives scene.mp4
  video: string;
  start: number; // recording second the scene begins at
  plan: FitPlan;
  wav: string; // scene narration, already padded to plan.outLen
  layout: Layout;
  bg: string;
  mask: string;
  fontSize: number;
};

export function renderScene(s: SceneRender): string {
  const { layout: l, plan } = s;
  const pad = plan.freeze > 0 ? `,tpad=stop_mode=clone:stop_duration=${plan.freeze.toFixed(3)}` : "";
  const graph = [
    `[0:v]fps=${FPS},setpts=${plan.factor.toFixed(6)}*(PTS-STARTPTS),scale=${l.screenW}:${l.screenH}:flags=lanczos${pad},format=yuva420p[p]`,
    "[2:v]format=gray[m]",
    "[p][m]alphamerge[pm]",
    `[1:v][pm]overlay=${l.x}:${l.y}:format=auto,ass=scene.ass,format=yuv420p[v]`,
    "[3:a]aresample=48000,apad[a]",
  ].join(";");

  const out = path.join(s.dir, "scene.mp4");
  run(
    "ffmpeg",
    [
      "-y", "-v", "error",
      "-ss", s.start.toFixed(3), "-t", plan.srcTake.toFixed(3), "-i", s.video,
      "-loop", "1", "-framerate", String(FPS), "-i", s.bg,
      "-loop", "1", "-framerate", String(FPS), "-i", s.mask,
      "-i", s.wav,
      "-filter_complex", graph,
      "-map", "[v]", "-map", "[a]",
      "-t", plan.outLen.toFixed(3),
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "1",
      "-movflags", "+faststart",
      out,
    ],
    s.dir,
  );
  return out;
}

/** Joins finished scene clips (identical encode settings) without re-encoding. */
export function concatScenes(sceneFiles: string[], listFile: string, out: string) {
  fs.writeFileSync(listFile, sceneFiles.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", out]);
}

export const TARGET_LUFS = -16;
export const TRUE_PEAK_DB = -1.5;
const LOUDNORM = `loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK_DB}:LRA=11`;

/**
 * Joins the finished scenes into the final mp4 with the narration normalized to about -16 LUFS
 * (true peak -1.5 dB). The video streams are copied; the audio is rebuilt from the scenes' own
 * wavs (not from their aac) so it is encoded once, after a two-pass loudnorm over the whole
 * narration: pass 1 measures, pass 2 applies the measured values linearly (one fixed gain, so the
 * pauses and the pacing are untouched). Returns a one-line summary of the measurement.
 */
export function finishWithLoudness(sceneVideos: string[], sceneWavs: string[], dir: string, out: string): string {
  const list = (files: string[]) => files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n");
  const videoList = path.join(dir, "concat-video.txt");
  const audioList = path.join(dir, "concat-audio.txt");
  const videoOnly = path.join(dir, "video-only.mp4");
  const audioIn = path.join(dir, "narration.wav");
  fs.writeFileSync(videoList, list(sceneVideos));
  fs.writeFileSync(audioList, list(sceneWavs));
  run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", videoList, "-an", "-c:v", "copy", videoOnly]);
  run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", audioList, "-c", "copy", audioIn]);

  const pass1 = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", audioIn, "-af", `${LOUDNORM}:print_format=json`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (pass1.status !== 0) throw new Error(`loudnorm measurement failed:\n${(pass1.stderr || "").split("\n").slice(-8).join("\n")}`);
  const json = (pass1.stderr || "").match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!json) throw new Error("loudnorm printed no measurement.");
  const m = JSON.parse(json[0]) as Record<string, string>;
  const apply =
    `${LOUDNORM}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
    `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;

  run("ffmpeg", [
    "-y", "-v", "error", "-i", videoOnly, "-i", audioIn,
    "-map", "0:v", "-map", "1:a", "-af", `${apply},aresample=48000`,
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "1",
    "-shortest", "-movflags", "+faststart", out,
  ]);
  return `${Number(m.input_i).toFixed(1)} LUFS (peak ${Number(m.input_tp).toFixed(1)} dB) -> about ${TARGET_LUFS} LUFS, true peak limit ${TRUE_PEAK_DB} dB`;
}
