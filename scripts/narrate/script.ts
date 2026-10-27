/**
 * Pure helpers: narration-script parsing, caption cues, SRT, and the video/audio fit plan.
 * No I/O, so script.test.ts can cover them.
 *
 * Script format (.txt):
 *   # comment
 *   == Scene name | 0-12.5        recording segment in seconds ("| 8-" = to the end, no range = whole video)
 *   Paragraph one.                 paragraphs are separated by a blank line
 *
 *   [@9.2] Paragraph two.          [@s] starts this paragraph at second s of the RECORDING
 */

export type Paragraph = { text: string; at: number | null };
export type Scene = { name: string; start: number; end: number | null; paragraphs: Paragraph[] };

export function parseScript(src: string): Scene[] {
  const scenes: Scene[] = [];
  let current: Scene | null = null;
  let buf: string[] = [];

  const flush = () => {
    const joined = buf.join(" ").replace(/\s+/g, " ").trim();
    buf = [];
    if (!joined) return;
    if (!current) {
      current = { name: "Scene 1", start: 0, end: null, paragraphs: [] };
      scenes.push(current);
    }
    const m = joined.match(/^\[@\s*(\d+(?:\.\d+)?)\s*\]\s*(.*)$/);
    const text = m ? m[2] : joined;
    if (!text) throw new Error(`Marker with no text: "${joined}"`);
    current.paragraphs.push({ text, at: m ? Number(m[1]) : null });
  };

  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#")) continue;
    const header = line.match(/^==\s*(.*?)\s*(?:\|\s*(\d+(?:\.\d+)?)?\s*-\s*(\d+(?:\.\d+)?)?\s*)?$/);
    if (header && line.startsWith("==")) {
      flush();
      current = {
        name: header[1] || `Scene ${scenes.length + 1}`,
        start: header[2] ? Number(header[2]) : 0,
        end: header[3] ? Number(header[3]) : null,
        paragraphs: [],
      };
      scenes.push(current);
    } else if (line === "") {
      flush();
    } else {
      buf.push(line);
    }
  }
  flush();
  return scenes.filter((s) => s.paragraphs.length > 0);
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Greedy word wrap; a word longer than the line stays alone on its line. */
export function wrapLines(text: string, lineChars: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + word.length > lineChars) {
      lines.push(cur);
      cur = word;
    } else {
      cur = cur ? `${cur} ${word}` : word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export type Cue = { start: number; end: number; text: string };

export type TimedText = { text: string; start: number; end: number };

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;
const MIN_WORDS = 4;

/** Splits after each comma (the comma stays on its clause). */
function clauses(sentence: string): string[] {
  return sentence.split(/(?<=,)\s+/).map((c) => c.trim()).filter(Boolean);
}

/**
 * Cuts an over-long run of words into the fewest cues of at most `maxLines` lines, balanced by
 * length so the last one is not a stub; falls back to filling line by line.
 */
function balancedChunks(text: string, lineChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const n = Math.ceil(wrapLines(text, lineChars).length / maxLines);
  if (n <= 1) return [text];
  const target = text.length / n;
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    const len = [...cur, w].join(" ").length;
    if (cur.length && chunks.length < n - 1 && len > target && Math.abs(len - target) > Math.abs(cur.join(" ").length - target)) {
      chunks.push(cur.join(" "));
      cur = [w];
    } else cur.push(w);
  }
  chunks.push(cur.join(" "));
  if (chunks.every((c) => wrapLines(c, lineChars).length <= maxLines)) return chunks;
  const lines = wrapLines(text, lineChars);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += maxLines) out.push(lines.slice(i, i + maxLines).join(" "));
  return out;
}

type Piece = { text: string; start: number; end: number; sentence: number };

/**
 * Caption cues for the sentences of one paragraph. Each sentence is one cue when it fits in
 * `maxLines` lines; otherwise it breaks after commas first (clauses packed greedily), and only
 * a clause that is still too long is cut by length. A cue is never left with fewer than
 * MIN_WORDS words: it joins a neighbour (the same sentence's first, then the next sentence, then
 * the previous) as long as the result still fits, so "Snap it. Sort it." stays together and a
 * short phrase is never split. Time inside a sentence is shared out by character count.
 */
export function buildCues(items: TimedText[], lineChars: number, maxLines: number): Cue[] {
  const fits = (t: string) => wrapLines(t, lineChars).length <= maxLines;
  let pieces: Piece[] = [];

  items.forEach((it, si) => {
    const texts: string[] = [];
    if (fits(it.text)) texts.push(it.text);
    else {
      let cur = "";
      for (const c of clauses(it.text)) {
        if (!cur) cur = c;
        else if (fits(`${cur} ${c}`)) cur = `${cur} ${c}`;
        else { texts.push(cur); cur = c; }
      }
      if (cur) texts.push(cur);
    }
    const parts = texts.flatMap((t) => (fits(t) ? [t] : balancedChunks(t, lineChars, maxLines)));
    const total = parts.reduce((a, t) => a + t.length, 0) || 1;
    let t0 = it.start;
    for (const text of parts) {
      const d = ((it.end - it.start) * text.length) / total;
      pieces.push({ text, start: t0, end: t0 + d, sentence: si });
      t0 += d;
    }
  });

  const join = (a: Piece, b: Piece): Piece => ({
    text: `${a.text} ${b.text}`, start: a.start, end: b.end, sentence: a.sentence,
  });
  for (;;) {
    let merged = false;
    for (let i = 0; i < pieces.length && !merged; i++) {
      if (wordCount(pieces[i].text) >= MIN_WORDS) continue;
      const prev = i > 0 && fits(`${pieces[i - 1].text} ${pieces[i].text}`) ? i - 1 : -1;
      const next = i < pieces.length - 1 && fits(`${pieces[i].text} ${pieces[i + 1].text}`) ? i + 1 : -1;
      const same = (j: number) => j >= 0 && pieces[j].sentence === pieces[i].sentence;
      const pick = same(next) ? next : same(prev) ? prev : next >= 0 ? next : prev;
      if (pick < 0) continue; // nothing it fits with: stays alone
      const [lo, hi] = pick < i ? [pick, i] : [i, pick];
      pieces = [...pieces.slice(0, lo), join(pieces[lo], pieces[hi]), ...pieces.slice(hi + 1)];
      merged = true;
    }
    if (!merged) break;
  }

  return pieces.map((p) => ({ start: p.start, end: p.end, text: wrapLines(p.text, lineChars).join("\n") }));
}

/** One sentence spoken over [start, end] (see buildCues). */
export function sentenceCues(sentence: string, start: number, end: number, lineChars: number, maxLines: number): Cue[] {
  return buildCues([{ text: sentence, start, end }], lineChars, maxLines);
}

/** Sentence time spans inside a paragraph spoken as ONE clip: shared by character count. */
export function proportionalSpans(sentences: string[], start: number, end: number): [number, number][] {
  const total = sentences.reduce((a, s) => a + s.length, 0) || 1;
  let t = start;
  return sentences.map((s) => {
    const d = ((end - start) * s.length) / total;
    const span: [number, number] = [t, t + d];
    t += d;
    return span;
  });
}

export function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms % 1000, 3)}`;
}

export function toSrt(cues: Cue[], offset = 0): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${srtTime(c.start + offset)} --> ${srtTime(c.end + offset)}\n${c.text}\n`)
      .join("\n") + "\n"
  );
}

export type FitPlan = {
  /** seconds of the recording to read, from the scene's start */
  srcTake: number;
  /** setpts multiplier: 1 = real time, <1 faster, >1 slower */
  factor: number;
  /** seconds the last frame is held at the end */
  freeze: number;
  /** length of the finished scene (video and audio) */
  outLen: number;
  note: string;
};

/**
 * Fits the recording segment to the narration without ever touching the audio.
 * `segDur` = recording seconds available, `audioLen` = narration incl. marker silences.
 * With [@s] markers the video plays at real speed (a speed change would move the markers):
 * it is trimmed, or its last frame held.
 */
export function planFit(
  segDur: number,
  audioLen: number,
  hasMarkers: boolean,
  opts: { tail?: number; maxSpeedUp?: number; maxSlowDown?: number } = {},
): FitPlan {
  const tail = opts.tail ?? 0.5;
  const maxSpeedUp = opts.maxSpeedUp ?? 1.25;
  const maxSlow = opts.maxSlowDown ?? 1.3;
  const out = audioLen + tail;
  const fmt = (n: number) => n.toFixed(1);

  if (hasMarkers || (out <= segDur && segDur / out > maxSpeedUp)) {
    if (out <= segDur) {
      const cut = segDur - out;
      return { srcTake: out, factor: 1, freeze: 0, outLen: out, note: cut > 0.05 ? `trimmed ${fmt(cut)} s off the end` : "exact fit" };
    }
    return { srcTake: segDur, factor: 1, freeze: out - segDur, outLen: out, note: `held last frame ${fmt(out - segDur)} s` };
  }
  if (out <= segDur) {
    return { srcTake: segDur, factor: out / segDur, freeze: 0, outLen: out, note: `video sped up ${fmt(segDur / out)}x` };
  }
  if (out / segDur <= maxSlow) {
    return { srcTake: segDur, factor: out / segDur, freeze: 0, outLen: out, note: `video slowed ${fmt(out / segDur)}x` };
  }
  return { srcTake: segDur, factor: 1, freeze: out - segDur, outLen: out, note: `narration is ${fmt(out - segDur)} s longer than the segment: held last frame (consider a shorter script)` };
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(cs / 360000)}:${p(Math.floor((cs % 360000) / 6000))}:${p(Math.floor((cs % 6000) / 100))}.${p(cs % 100)}`;
}

/**
 * The same cues as an ASS file on a 1:1 pixel canvas. (An .srt burned in through `subtitles` is
 * laid out on a 384x288 canvas and scaled up, so font size and margins come out wildly off.)
 */
export function toAss(
  cues: Cue[],
  o: { width: number; height: number; fontSize: number; marginL: number; marginR: number },
): string {
  const events = cues
    .map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,${c.text.replace(/\n/g, "\\N")}`)
    .join("\n");
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${o.width}
PlayResY: ${o.height}
WrapStyle: 2

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Cap,Arial,${o.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,4,${o.marginL},${o.marginR},0,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${events}
`;
}
