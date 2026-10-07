import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  cleanClientTimings,
  formatDuration,
  formatElapsed,
  logTiming,
  shortId,
  stopwatch,
} from "./statement-timing.ts";

// Timing for every stage of a statement import: the stopwatch, what the browser reports back, how a
// duration is shown to the person, and that the logging can never carry statement content.

const fakeClock = (...ticks: number[]) => {
  let i = 0;
  return () => ticks[Math.min(i++, ticks.length - 1)];
};

test("a stopwatch records each lap as the time since the previous one, and a total", () => {
  // start, lap auth, lap model, lap save, snapshot
  const t = stopwatch(fakeClock(1000, 1050, 10_450, 10_600, 10_700), () => new Date("2026-10-07T12:00:00.000Z"));
  assert.equal(t.lap("auth"), 50);
  assert.equal(t.lap("model"), 9400);
  assert.equal(t.lap("save"), 150);
  assert.deepEqual(t.snapshot(), { auth_ms: 50, model_ms: 9400, save_ms: 150, total_ms: 9700 });
  assert.equal(t.startedAt(), "2026-10-07T12:00:00.000Z");
});

test("the same lap name twice adds up (a stage that runs more than once)", () => {
  const t = stopwatch(fakeClock(0, 10, 25, 25));
  t.lap("match");
  t.lap("match");
  assert.equal(t.snapshot().match_ms, 25);
});

test("counts are recorded under their exact key (rows read, bytes), not as durations", () => {
  const t = stopwatch(fakeClock(0, 5, 5));
  t.note("match_receipts_rows", 21);
  t.note("file_bytes", 482_113);
  const s = t.snapshot();
  assert.equal(s.match_receipts_rows, 21);
  assert.equal(s.file_bytes, 482_113);
});

test("logTiming writes ONE [statement-timing] line of JSON with the stage first", () => {
  const original = console.log;
  const lines: unknown[][] = [];
  console.log = (...args: unknown[]) => void lines.push(args);
  try {
    logTiming("chunk", { import: shortId("e3e3486f-aaaa-bbbb-cccc-dddddddddddd"), chunk_no: 1, model_ms: 9400, ok: true });
  } finally {
    console.log = original;
  }
  assert.equal(lines.length, 1);
  assert.equal(lines[0][0], "[statement-timing]");
  assert.deepEqual(JSON.parse(lines[0][1] as string), { stage: "chunk", import: "e3e3486f", chunk_no: 1, model_ms: 9400, ok: true });
});

// ---- what the browser sends back ---------------------------------------------------------------

const good = {
  prepare_ms: 850,
  start_ms: 420,
  read_ms: 11_900,
  mode: "whole",
  pages: 6,
  file_bytes: 482_113,
  chunks: [{ chunk_no: 1, pages: "1-6", slice_ms: 2, request_ms: 11_800, server_ms: 10_900, transfer_ms: 900, retries: 0 }],
};

test("the browser's timings are accepted as plain numbers", () => {
  assert.deepEqual(cleanClientTimings(good), good);
});

test("nonsense is rejected or clamped, never trusted: missing figures, negatives, huge or non-numbers", () => {
  assert.equal(cleanClientTimings(null), null);
  assert.equal(cleanClientTimings("x"), null);
  assert.equal(cleanClientTimings({ ...good, prepare_ms: -5 }), null);
  assert.equal(cleanClientTimings({ ...good, read_ms: "fast" }), null);
  assert.equal(cleanClientTimings({ ...good, start_ms: 9e12 }), null);
  const odd = cleanClientTimings({
    ...good,
    mode: "<script>",
    pages: 1e9,
    chunks: [{ chunk_no: 1, pages: "1-3<script>alert(1)</script>", request_ms: 100, server_ms: "soon", retries: 9999 }, null, "x", { chunk_no: -1, request_ms: 1 }],
  })!;
  assert.equal(odd.mode, "split", "anything but 'whole' is 'split'");
  assert.equal(odd.pages, 0);
  assert.equal(odd.chunks.length, 1, "malformed chunk entries are dropped");
  assert.match(odd.chunks[0].pages, /^[0-9-]*$/, "only digits and a dash survive in the page label");
  assert.doesNotMatch(odd.chunks[0].pages, /[a-z<>()]/i);
  assert.equal(odd.chunks[0].server_ms, null);
  assert.equal(odd.chunks[0].retries, 0);
});

test("at most 40 chunk entries are kept", () => {
  const chunks = Array.from({ length: 200 }, (_, i) => ({ chunk_no: i + 1, pages: "1", request_ms: 1 }));
  assert.equal(cleanClientTimings({ ...good, chunks })!.chunks.length, 40);
});

// ---- how a duration is shown ---------------------------------------------------------------------

test("durations and the elapsed clock read naturally", () => {
  assert.equal(formatDuration(850), "850 ms");
  assert.equal(formatDuration(9400), "9.4 s");
  assert.equal(formatDuration(12_500), "13 s");
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(7_400), "0:07");
  assert.equal(formatElapsed(83_000), "1:23");
  assert.equal(formatElapsed(-500), "0:00", "a clock that starts a hair early never shows negative time");
});

// ---- nothing identifying or financial is ever logged -----------------------------------------------

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

// Every logTiming(...) call, including its multi-line object, from the source text.
function logCalls(source: string): string[] {
  const calls: string[] = [];
  let from = 0;
  for (;;) {
    const i = source.indexOf("logTiming(", from);
    if (i < 0) return calls;
    let depth = 0;
    let j = source.indexOf("(", i);
    const start = j;
    for (; j < source.length; j++) {
      if (source[j] === "(") depth++;
      if (source[j] === ")" && --depth === 0) break;
    }
    calls.push(source.slice(start, j + 1));
    from = j;
  }
}

test("every stage logs a [statement-timing] line, and no log call can carry statement content or a user id", () => {
  const files: Record<string, string[]> = {
    "src/app/api/statements/route.ts": ['"start"'],
    "src/app/api/statements/[id]/chunks/[n]/route.ts": ['"chunk"'],
    "src/app/api/statements/[id]/finalize/route.ts": ['"finalize"', '"client-summary"'],
    "src/app/api/statements/[id]/route.ts": ['"review-load"'],
    "src/app/(app)/dashboard/expenses/statements/[id]/page.tsx": ['"review-load"'],
  };
  for (const [file, stages] of Object.entries(files)) {
    const calls = logCalls(read(file));
    for (const stage of stages) assert.ok(calls.some((c) => c.includes(stage)), `${file} logs ${stage}`);
    for (const call of calls) {
      assert.doesNotMatch(call, /user\.id|user_id|email|description|merchant|amount|\.lines\b(?!\.length)|category/i, `${file}: ${call.slice(0, 80)}`);
    }
  }
});
