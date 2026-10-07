// Timing for every stage of a statement import, so "it feels slow" can be answered with numbers.
// Pure and import-free, so it runs in the browser, in route handlers and in node tests.
//
// A stopwatch records LAPS: each call to lap(name) stores the time since the previous lap (or since
// the start). The server writes one log line per stage -
//   [statement-timing] {"stage":"chunk","import":"e3e3486f","chunk_no":1,...,"model_ms":9400,...}
// - and returns the same numbers to the browser, which adds what only it can see (reading and hashing
// the file, upload and network time) and sends the whole picture back with the finalize request so
// one log line holds the browser's side too. Nothing here ever includes statement content, amounts,
// descriptions or a user id.

export type Laps = Record<string, number>;

export interface Stopwatch {
  /** Records the time since the previous lap under `${name}_ms`. */
  lap(name: string): number;
  /** Records a number under an exact key (a count, a byte size). */
  note(key: string, value: number): void;
  /** Everything recorded so far, plus total_ms since the start. */
  snapshot(): Laps;
  /** When the stopwatch started, as an ISO time (for "start / finish" in the logs). */
  startedAt(): string;
}

export function stopwatch(
  clock: () => number = () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  wallClock: () => Date = () => new Date(),
): Stopwatch {
  const t0 = clock();
  const started = wallClock();
  let last = t0;
  const laps: Laps = {};
  return {
    lap(name) {
      const now = clock();
      const ms = Math.round(now - last);
      last = now;
      laps[`${name}_ms`] = (laps[`${name}_ms`] ?? 0) + ms;
      return ms;
    },
    note(key, value) {
      laps[key] = value;
    },
    snapshot() {
      return { ...laps, total_ms: Math.round(clock() - t0) };
    },
    startedAt() {
      return started.toISOString();
    },
  };
}

const PREFIX = "[statement-timing]";

/** One structured line per stage in the server log (Vercel keeps it with the request). */
export function logTiming(stage: string, data: Record<string, unknown>): void {
  console.log(PREFIX, JSON.stringify({ stage, ...data }));
}

/** A short, non-identifying id for correlating the lines of one import. */
export const shortId = (id: string): string => id.slice(0, 8);

// ---------------------------------------------------------------------------
// What the browser sends back with the finalize request
// ---------------------------------------------------------------------------

export interface ClientChunkTiming {
  chunk_no: number;
  pages: string;
  /** Producing the page slice (splitting the PDF / compressing a photo). */
  slice_ms: number;
  /** The whole request as the browser saw it, including any automatic retries. */
  request_ms: number;
  /** What the server reported for its own work on that request. */
  server_ms: number | null;
  /** request_ms minus server_ms: upload + download + queueing + cold start. */
  transfer_ms: number | null;
  /** Whether the browser had to retry it automatically. */
  retries: number;
}

export interface ClientTimings {
  /** Opening the file, hashing it and checking its pages (all in the browser). */
  prepare_ms: number;
  /** POST /api/statements (cap check, create the draft). */
  start_ms: number;
  /** First chunk start to last chunk finish, as the browser saw it. */
  read_ms: number;
  chunks: ClientChunkTiming[];
  mode: "split" | "whole";
  pages: number;
  file_bytes: number;
}

const num = (v: unknown, max = 3_600_000): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : null;

// The server never trusts the browser's numbers for anything but this log line, so they're clamped
// and reduced to plain numbers and a short string before they're written anywhere.
export function cleanClientTimings(value: unknown): ClientTimings | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const prepare = num(v.prepare_ms);
  const start = num(v.start_ms);
  const read = num(v.read_ms);
  if (prepare === null || start === null || read === null) return null;
  const chunks = Array.isArray(v.chunks) ? v.chunks.slice(0, 40) : [];
  return {
    prepare_ms: prepare,
    start_ms: start,
    read_ms: read,
    mode: v.mode === "whole" ? "whole" : "split",
    pages: num(v.pages, 1000) ?? 0,
    file_bytes: num(v.file_bytes, 200 * 1024 * 1024) ?? 0,
    chunks: chunks.flatMap((c): ClientChunkTiming[] => {
      if (!c || typeof c !== "object") return [];
      const r = c as Record<string, unknown>;
      const chunkNo = num(r.chunk_no, 1000);
      const request = num(r.request_ms);
      if (chunkNo === null || request === null) return [];
      return [
        {
          chunk_no: chunkNo,
          pages: typeof r.pages === "string" ? r.pages.replace(/[^0-9-]/g, "").slice(0, 12) : "",
          slice_ms: num(r.slice_ms) ?? 0,
          request_ms: request,
          server_ms: num(r.server_ms),
          transfer_ms: num(r.transfer_ms),
          retries: num(r.retries, 20) ?? 0,
        },
      ];
    }),
  };
}

// "9.4 s" / "850 ms" - how a duration is shown to the person.
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`;
}

/** "0:07", "1:23" - an elapsed clock. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
