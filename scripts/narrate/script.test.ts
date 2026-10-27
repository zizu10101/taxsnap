// Run: node --test scripts/narrate/
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCues, parseScript, planFit, proportionalSpans, sentenceCues, splitSentences, srtTime, wrapLines } from "./script.ts";

test("parseScript reads scenes, ranges, paragraphs and [@s] markers", () => {
  const scenes = parseScript(`# note
== Intro | 0-8.5
Hello there. Welcome.
Still the same paragraph.

[@6] Second one.

== Rest | 8.5-
Last bit.
`);
  assert.equal(scenes.length, 2);
  assert.deepEqual([scenes[0].name, scenes[0].start, scenes[0].end], ["Intro", 0, 8.5]);
  assert.equal(scenes[0].paragraphs[0].text, "Hello there. Welcome. Still the same paragraph.");
  assert.deepEqual(scenes[0].paragraphs[1], { text: "Second one.", at: 6 });
  assert.deepEqual([scenes[1].start, scenes[1].end], [8.5, null]);
});

test("a script with no scene header is one whole-video scene", () => {
  const scenes = parseScript("Just text.");
  assert.equal(scenes.length, 1);
  assert.deepEqual([scenes[0].start, scenes[0].end], [0, null]);
});

test("sentences split on end punctuation followed by a space, not inside $1.50", () => {
  assert.deepEqual(splitSentences("It costs $1.50 today. Go! Really?"), ["It costs $1.50 today.", "Go!", "Really?"]);
});

test("captions never exceed maxLines and cover the sentence's whole time span", () => {
  const s = "Take a clear photo of the whole receipt, then wait a few seconds while TaxSnap reads it.";
  const cues = sentenceCues(s, 2, 8, 24, 3);
  assert.ok(cues.length >= 2);
  for (const c of cues) assert.ok(c.text.split("\n").length <= 3);
  assert.ok(Math.abs(cues[0].start - 2) < 1e-9 && Math.abs(cues[cues.length - 1].end - 8) < 1e-9);
  for (let i = 1; i < cues.length; i++) assert.ok(Math.abs(cues[i].start - cues[i - 1].end) < 1e-9);
});

const cuesFor = (paragraph: string, from = 0, to = 10) => {
  const sentences = splitSentences(paragraph);
  const spans = proportionalSpans(sentences, from, to);
  return buildCues(sentences.map((text, i) => ({ text, start: spans[i][0], end: spans[i][1] })), 24, 3);
};
const flat = (c: { text: string }) => c.text.replace(/\n/g, " ");
const words = (c: { text: string }) => flat(c).split(" ").length;

test("captions break after a comma when a sentence does not fit, not mid-phrase", () => {
  const cues = cuesFor("From your dashboard, tap Scan Receipt, then snap a photo or upload one you already have.");
  assert.deepEqual(cues.map(flat), [
    "From your dashboard, tap Scan Receipt,",
    "then snap a photo or upload one you already have.",
  ]);
});

test("a one-word sentence joins its neighbour instead of becoming an orphan cue", () => {
  const cues = cuesFor("Saved. The tax is counted in your HST helper, so at filing time you already know your numbers.");
  assert.deepEqual(cues.map(flat), [
    "Saved. The tax is counted in your HST helper,",
    "so at filing time you already know your numbers.",
  ]);
});

test("short sentences stay whole and no cue has fewer than 4 words", () => {
  const cues = cuesFor("Snap it. Sort it. Write it off. TaxSnap.");
  assert.deepEqual(cues.map(flat), ["Snap it. Sort it.", "Write it off. TaxSnap."]);
  for (const text of [
    "TaxSnap reads the receipt for you. There's nothing to type.",
    "It fills in the merchant, date, tax and total, and suggests a category. Check it, fix anything that's off, then save.",
    "Take a clear photo of the whole receipt, then wait a few seconds while TaxSnap reads it. Check the vendor, the date and the total, and save.",
  ]) {
    for (const c of cuesFor(text)) {
      assert.ok(words(c) >= 4, `orphan: "${flat(c)}"`);
      assert.ok(c.text.split("\n").length <= 3);
    }
  }
});

test("cues are contiguous and keep the paragraph's time span", () => {
  const cues = cuesFor("Saved. The tax is counted in your HST helper, so at filing time you already know your numbers.", 4, 12);
  assert.ok(Math.abs(cues[0].start - 4) < 1e-9 && Math.abs(cues[cues.length - 1].end - 12) < 1e-9);
  for (let i = 1; i < cues.length; i++) assert.ok(Math.abs(cues[i].start - cues[i - 1].end) < 1e-9);
});

test("an over-long clause with no comma is cut into balanced cues, not a stub", () => {
  const cues = cuesFor("then snap a photo or upload one you already have today from your phone or your computer right now please");
  assert.ok(cues.length >= 2);
  for (const c of cues) assert.ok(words(c) >= 4);
});

test("wrapLines keeps an overlong word on its own line", () => {
  assert.deepEqual(wrapLines("a supercalifragilistic b", 8), ["a", "supercalifragilistic", "b"]);
});

test("proportionalSpans share time by length and end where the clip ends", () => {
  const spans = proportionalSpans(["aaaa", "bbbbbbbb"], 0, 3);
  assert.deepEqual(spans, [[0, 1], [1, 3]]);
});

test("srtTime formats", () => assert.equal(srtTime(3661.5), "01:01:01,500"));

test("planFit: the audio is never stretched, only the video moves", () => {
  // video longer by a lot -> trim at real speed
  assert.deepEqual(pick(planFit(30, 10, false)), { srcTake: 10.5, factor: 1, freeze: 0 });
  // video a little longer -> speed up (factor < 1)
  const fast = planFit(12, 10, false);
  assert.ok(fast.factor < 1 && Math.abs(fast.factor * 12 - fast.outLen) < 1e-9);
  // audio a little longer -> slow down (factor > 1)
  const slow = planFit(10, 11, false);
  assert.ok(slow.factor > 1 && Math.abs(slow.factor * 10 - slow.outLen) < 1e-9);
  // audio far longer -> hold the last frame at real speed
  const held = planFit(10, 20, false);
  assert.equal(held.factor, 1);
  assert.ok(Math.abs(held.freeze - 10.5) < 1e-9);
  // markers forbid a speed change
  assert.equal(planFit(12, 10, true).factor, 1);
  assert.equal(planFit(10, 10, true).factor, 1);
});

function pick(p: { srcTake: number; factor: number; freeze: number }) {
  return { srcTake: p.srcTake, factor: p.factor, freeze: p.freeze };
}
