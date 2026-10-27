/**
 * Narrated how-to videos: narration script (.txt) + an existing phone recording (mp4) ->
 * 1920x1080 mp4 with Gemini voice-over and burned-in captions.
 *
 *   node scripts/narrate/narrate.ts samples                 voice / model / per-sentence samples
 *   node scripts/narrate/narrate.ts render <name>           every scene (cached audio is reused)
 *   node scripts/narrate/narrate.ts render <name> --scene 2 regenerate scene 2 alone (fresh audio)
 *   add --fake-audio to test the video side with a tone instead of calling the API (free)
 *
 * <name> is a key in config.json "videos"; its narration is scripts/<name>.txt next to this file.
 * Everything generated goes to scripts/narrate/out/ (gitignored). Never to public/videos/.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  buildAssets, finishWithLoudness, H, layoutFor, probe, renderScene, requireFfmpeg, TEXT_LEFT, W,
} from "./compose.ts";
import {
  buildCues, planFit, parseScript, proportionalSpans, splitSentences, toAss, toSrt,
  type Cue, type Scene, type TimedText,
} from "./script.ts";
import { pcmSeconds, pcmToWav, silence, synthesize, type TtsOptions } from "./tts.ts";

const HERE = import.meta.dirname;
const ROOT = path.join(HERE, "..", "..");
const OUT = path.join(HERE, "out");
const CACHE = path.join(OUT, ".cache");

type Config = {
  model: string; voice: string; style: string;
  granularity: "paragraph" | "sentence";
  paragraphGapSec: number; sentenceGapSec: number; tailSec: number;
  caption: { fontSize: number; lineChars: number; maxLines: number };
  videos: Record<string, { input: string }>;
};
const config: Config = JSON.parse(fs.readFileSync(path.join(HERE, "config.json"), "utf8"));

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const flagValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fake = flag("--fake-audio");

/** Stand-in for the API: a quiet tone, ~15 characters per second of speech. */
function fakeSpeech(text: string): Buffer {
  const secs = Math.max(0.8, text.length / 15);
  const r = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=220:sample_rate=24000:duration=${secs}`, "-af", "volume=0.05", "-f", "s16le", "-ac", "1", "-"], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error("ffmpeg could not make the test tone.");
  return r.stdout;
}
const speak = (text: string, o: TtsOptions, fresh = false) =>
  fake ? Promise.resolve(fakeSpeech(text)) : synthesize(text, o, CACHE, fresh);

const baseOpts: TtsOptions = { model: config.model, voice: config.voice, style: config.style };

function writeWav(file: string, pcm: Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, pcmToWav(pcm));
  console.log(`  ${path.relative(ROOT, file)}  (${pcmSeconds(pcm).toFixed(1)} s)`);
}

/* ------------------------------------------------------------------ samples */

async function samples() {
  const dir = path.join(OUT, "samples");
  const line = "Snap a photo of your receipt, and TaxSnap fills in the vendor, the total and the HST for you.";
  const paragraph =
    "Open the Expenses tab and tap Add receipt. Take a clear photo of the whole receipt, then wait a few seconds while TaxSnap reads it. Check the vendor, the date and the total, and save.";
  console.log("Voices (one sentence, flash model):");
  for (const voice of ["Kore", "Achird", "Sulafat", "Charon"]) {
    writeWav(path.join(dir, `1-voice-${voice}.wav`), await synthesize(line, { ...baseOpts, voice }, CACHE));
  }
  console.log("Model A/B (paragraph, same voice):");
  writeWav(path.join(dir, "2-model-flash.wav"), await synthesize(paragraph, baseOpts, CACHE));
  writeWav(path.join(dir, "2-model-flash-lite.wav"), await synthesize(paragraph, { ...baseOpts, model: "gemini-3.8-flash-lite-tts" }, CACHE));
  console.log("Per-sentence vs whole paragraph (flash, same voice):");
  writeWav(path.join(dir, "3-whole-paragraph.wav"), await synthesize(paragraph, baseOpts, CACHE));
  const parts: Buffer[] = [];
  for (const [i, s] of splitSentences(paragraph).entries()) {
    if (i > 0) parts.push(silence(config.sentenceGapSec));
    parts.push(await synthesize(s, baseOpts, CACHE));
  }
  writeWav(path.join(dir, "3-per-sentence.wav"), Buffer.concat(parts));
  console.log("\nSample text was my own placeholder, not your narration.");
}

/* ------------------------------------------------------------------- render */

type SceneAudio = { pcm: Buffer; cues: Cue[]; hasMarkers: boolean };

/** One audio clip per scene: paragraphs joined with gaps, [@s] markers padded with silence. */
async function sceneAudio(scene: Scene, fresh: boolean): Promise<SceneAudio> {
  const { lineChars, maxLines } = config.caption;
  const parts: Buffer[] = [];
  const cues: Cue[] = [];
  let t = 0;
  const push = (b: Buffer) => { parts.push(b); t += pcmSeconds(b); };
  let hasMarkers = false;

  for (const [i, p] of scene.paragraphs.entries()) {
    if (p.at !== null) {
      hasMarkers = true;
      const target = p.at - scene.start;
      if (target < 0) console.warn(`  ! [@${p.at}] is before the scene starts (${scene.start}); starting at once`);
      else if (target < t - 0.01) console.warn(`  ! [@${p.at}] arrives while earlier narration still runs (${(t + scene.start).toFixed(1)} s); starting right after it`);
      else push(silence(target - t));
    } else if (i > 0) {
      push(silence(config.paragraphGapSec));
    }
    const sentences = splitSentences(p.text);
    const timed: TimedText[] = [];
    if (config.granularity === "sentence") {
      for (const [j, s] of sentences.entries()) {
        if (j > 0) push(silence(config.sentenceGapSec));
        const pcm = await speak(s, baseOpts, fresh);
        timed.push({ text: s, start: t, end: t + pcmSeconds(pcm) });
        push(pcm);
      }
    } else {
      const pcm = await speak(p.text, baseOpts, fresh);
      const spans = proportionalSpans(sentences, t, t + pcmSeconds(pcm));
      sentences.forEach((s, j) => timed.push({ text: s, start: spans[j][0], end: spans[j][1] }));
      push(pcm);
    }
    // Cues are built per paragraph so short sentences can join a neighbour (never across a pause).
    cues.push(...buildCues(timed, lineChars, maxLines));
  }
  return { pcm: Buffer.concat(parts), cues, hasMarkers };
}

async function render(name: string) {
  const entry = config.videos[name];
  if (!entry) throw new Error(`"${name}" is not in config.json "videos".`);
  const scriptFile = path.join(HERE, "scripts", `${name}.txt`);
  const scenes = parseScript(fs.readFileSync(scriptFile, "utf8"));
  if (scenes.length === 0) throw new Error(`${scriptFile} has no narration.`);
  const video = path.join(ROOT, entry.input);
  const info = probe(video);
  const only = flagValue("--scene") ? Number(flagValue("--scene")) : null;
  if (only !== null && !(only >= 1 && only <= scenes.length)) throw new Error(`--scene must be 1-${scenes.length}.`);

  const dir = path.join(OUT, name);
  const layout = layoutFor(info.width, info.height);
  const assets = await buildAssets(path.join(dir, "assets"), layout);

  const clips: string[] = [];
  const allCues: Cue[] = [];
  let offset = 0;

  for (const [idx, scene] of scenes.entries()) {
    const n = idx + 1;
    const sdir = path.join(dir, `scene-${String(n).padStart(2, "0")}`);
    const sceneMeta = path.join(sdir, "cues.json");
    const clip = path.join(sdir, "scene.mp4");

    if (only !== null && only !== n) {
      if (!fs.existsSync(clip) || !fs.existsSync(sceneMeta)) throw new Error(`Scene ${n} has not been rendered yet; run without --scene first.`);
      const meta = JSON.parse(fs.readFileSync(sceneMeta, "utf8")) as { cues: Cue[]; outLen: number };
      clips.push(clip);
      allCues.push(...meta.cues.map((c) => ({ ...c, start: c.start + offset, end: c.end + offset })));
      offset += meta.outLen;
      continue;
    }

    console.log(`Scene ${n}: ${scene.name}`);
    const end = scene.end ?? info.duration;
    if (scene.start >= info.duration || end > info.duration + 0.05) {
      throw new Error(`Scene ${n} range ${scene.start}-${end} is outside the recording (${info.duration.toFixed(1)} s).`);
    }
    const audio = await sceneAudio(scene, only === n);
    const plan = planFit(end - scene.start, pcmSeconds(audio.pcm), audio.hasMarkers, { tail: config.tailSec });
    console.log(`  narration ${pcmSeconds(audio.pcm).toFixed(1)} s, segment ${(end - scene.start).toFixed(1)} s -> ${plan.note}`);

    const padded = Buffer.concat([audio.pcm, silence(plan.outLen - pcmSeconds(audio.pcm))]);
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, "scene.wav"), pcmToWav(padded));
    fs.writeFileSync(path.join(sdir, "scene.srt"), toSrt(audio.cues));
    fs.writeFileSync(
      path.join(sdir, "scene.ass"),
      toAss(audio.cues, { width: W, height: H, fontSize: config.caption.fontSize, marginL: TEXT_LEFT, marginR: layout.marginR }),
    );
    fs.writeFileSync(sceneMeta, JSON.stringify({ cues: audio.cues, outLen: plan.outLen }));
    renderScene({
      dir: sdir, video, start: scene.start, plan, wav: path.join(sdir, "scene.wav"),
      layout, bg: assets.bg, mask: assets.mask, fontSize: config.caption.fontSize,
    });
    clips.push(clip);
    allCues.push(...audio.cues.map((c) => ({ ...c, start: c.start + offset, end: c.end + offset })));
    offset += plan.outLen;
  }

  const finalFile = path.join(dir, `${name}.narrated.mp4`);
  const loudness = finishWithLoudness(
    clips,
    clips.map((c) => path.join(path.dirname(c), "scene.wav")),
    dir,
    finalFile,
  );
  console.log(`Loudness: ${loudness}`);
  fs.writeFileSync(path.join(dir, "captions.srt"), toSrt(allCues));
  console.log(`\nDone: ${path.relative(ROOT, finalFile)} (${offset.toFixed(1)} s)\nCaptions: ${path.relative(ROOT, path.join(dir, "captions.srt"))}`);
}

/* --------------------------------------------------------------------- main */

async function main() {
  const [cmd, name] = args;
  requireFfmpeg();
  if (cmd === "samples") return samples();
  if (cmd === "render" && name) return render(name);
  console.error("Usage: node scripts/narrate/narrate.ts samples | render <name> [--scene N] [--fake-audio]");
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
