/**
 * Gemini text-to-speech over plain REST (the Interactions API), so this tool needs no
 * newer @google/genai than the one the app already has. The key is read from .env.local
 * into process.env and is only ever sent as a request header - never logged.
 *
 * Audio is handled as raw 24 kHz mono 16-bit PCM and is never time-stretched.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SAMPLE_RATE = 24000;
const ROOT = path.join(import.meta.dirname, "..", "..");
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

export type TtsOptions = { model: string; voice: string; style: string };

export function loadApiKey(): string {
  try {
    process.loadEnvFile(path.join(ROOT, ".env.local"));
  } catch {
    // fall through to the check below
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env.local");
  return key;
}

export function pcmSeconds(pcm: Buffer): number {
  return pcm.length / 2 / SAMPLE_RATE;
}

export function silence(seconds: number): Buffer {
  return Buffer.alloc(Math.max(0, Math.round(seconds * SAMPLE_RATE)) * 2);
}

export function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Accepts a RIFF/WAV (the unary default) or headerless PCM and returns the PCM bytes. */
export function pcmFromAudio(buf: Buffer): Buffer {
  if (buf.toString("ascii", 0, 4) !== "RIFF") return buf;
  let pos = 12;
  let rate = 0;
  let channels = 0;
  let bits = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(pos + 10);
      rate = buf.readUInt32LE(pos + 12);
      bits = buf.readUInt16LE(pos + 22);
    } else if (id === "data") {
      if (rate !== SAMPLE_RATE || channels !== 1 || bits !== 16) {
        throw new Error(`Unexpected audio format: ${rate} Hz, ${channels} ch, ${bits} bit (wanted 24000/1/16).`);
      }
      return buf.subarray(pos + 8, Math.min(buf.length, pos + 8 + size));
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error("WAV from the API had no data chunk.");
}

function findAudio(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const o = node as Record<string, unknown>;
  if (o.type === "audio" && typeof o.data === "string") return o.data;
  let found: string | null = null;
  for (const v of Object.values(o)) {
    const r = findAudio(v);
    if (r) found = r; // keep the last one, as the docs' own jq filter does
  }
  return found;
}

function cachePath(cacheDir: string, text: string, o: TtsOptions): string {
  const hash = crypto.createHash("sha1").update(JSON.stringify([o.model, o.voice, o.style, text])).digest("hex");
  return path.join(cacheDir, `${hash}.pcm`);
}

/** Speaks `text`; returns PCM. Cached by model+voice+style+text unless `fresh`. */
export async function synthesize(text: string, o: TtsOptions, cacheDir: string, fresh = false): Promise<Buffer> {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = cachePath(cacheDir, text, o);
  if (!fresh && fs.existsSync(file)) return fs.readFileSync(file);

  const body = {
    model: o.model,
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text,
            ...(o.style ? { annotations: [{ type: "speech_metadata", style: o.style }] } : {}),
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: o.voice }] },
  };
  const key = loadApiKey();

  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = findAudio(await res.json());
      if (!data) throw new Error("The API answered but no audio was in the response.");
      const pcm = pcmFromAudio(Buffer.from(data, "base64"));
      fs.writeFileSync(file, pcm);
      return pcm;
    }
    lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`TTS failed (${o.model}, ${o.voice}) - ${lastError}`);
}
