// Canvas-drawn "PAID" stamp. Lives apart from invoice-pdf.ts so the on-screen PaidStamp
// does not pull jsPDF into the invoice page bundle just to draw a canvas.

// A hand-jittered polygon path, not a clean ctx.rect()/roundRect() - real
// ink stamps never lay down a perfectly straight edge, so each edge of the
// rounded rectangle is subdivided and every intermediate point nudged by a
// small random offset before stroking. Called twice per border (see
// drawStampTexture) with fresh jitter each time, so the two passes don't
// land on the same wobble and the line reads as uneven ink coverage rather
// than a single consistent squiggle.
function jitteredRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  corner: number,
  jitter: number,
  segmentsPerEdge: number,
) {
  const hw = w / 2;
  const hh = h / 2;
  // Octagon-ish corners (straight bevels, not true arcs) - close enough to
  // "rounded" at stamp scale, and simpler to jitter than an arc.
  const base: [number, number][] = [
    [-hw + corner, -hh],
    [hw - corner, -hh],
    [hw, -hh + corner],
    [hw, hh - corner],
    [hw - corner, hh],
    [-hw + corner, hh],
    [-hw, hh - corner],
    [-hw, -hh + corner],
  ];

  const points: [number, number][] = [];
  for (let i = 0; i < base.length; i++) {
    const [x0, y0] = base[i];
    const [x1, y1] = base[(i + 1) % base.length];
    for (let s = 0; s < segmentsPerEdge; s++) {
      const t = s / segmentsPerEdge;
      points.push([
        x0 + (x1 - x0) * t + (Math.random() - 0.5) * jitter,
        y0 + (y1 - y0) * t + (Math.random() - 0.5) * jitter,
      ]);
    }
  }

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
}

// Renders the stamp onto an offscreen canvas at high resolution (crisp
// once scaled down into the PDF), pre-rotated so the exported PNG can be
// dropped straight into the page with pdf.addImage - simpler and more
// reliable than fighting jsPDF's own lower-level rotation/transform APIs,
// which aren't used anywhere else in this file. Every jitter/speckle
// parameter here is sized for how it actually prints - this canvas gets
// scaled down a lot (see drawPaidStamp), so subtle texture at native
// resolution would just get anti-aliased away into a clean-looking edge.
// Bigger, bolder wobble is what still reads as "rough" once shrunk.
// Exported so the on-screen invoice view (PaidStamp component) can render
// the exact same stamp graphic, not a separate CSS-approximated look-alike
// - one canvas-drawing implementation, two places it gets dropped in (a
// jsPDF page here, a plain <img> there).
export function createPaidStampDataUrl(): string {
  const size = 600;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const red = "#c11f1f";
  const angleRad = (-18 * Math.PI) / 180;

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(angleRad);

  const rectW = 380;
  const rectH = 190;

  // Double border, thicker outer / thinner inner - the uneven double-line
  // look of a stamp that's been pressed slightly off-register with itself.
  ctx.strokeStyle = red;
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 13;
  jitteredRoundedRectPath(ctx, rectW, rectH, 30, 11, 7);
  ctx.stroke();
  ctx.lineWidth = 6;
  jitteredRoundedRectPath(ctx, rectW - 24, rectH - 24, 24, 8, 7);
  ctx.stroke();

  // Bold, slightly uneven "PAID" - each letter gets its own small random
  // offset/rotation so the word doesn't look machine-typeset, then both
  // filled and stroked for a bolder, more defined edge than fill alone.
  const text = "PAID";
  ctx.font = "bold 132px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = red;
  ctx.strokeStyle = red;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.95;

  const letterWidths = text.split("").map((ch) => ctx.measureText(ch).width);
  const totalWidth = letterWidths.reduce((sum, w) => sum + w, 0);
  let cursorX = -totalWidth / 2;
  for (let i = 0; i < text.length; i++) {
    const letter = text[i];
    const letterCenterX = cursorX + letterWidths[i] / 2;
    ctx.save();
    ctx.translate(
      letterCenterX + (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 9,
    );
    ctx.rotate(((Math.random() - 0.5) * 7 * Math.PI) / 180);
    ctx.fillText(letter, 0, 0);
    ctx.strokeText(letter, 0, 0);
    ctx.restore();
    cursorX += letterWidths[i];
  }

  ctx.restore();

  // Worn-ink pass: punch small random transparent specks out of everything
  // drawn so far (border + text), concentrated more at the edges than the
  // center - real stamped ink is never perfectly solid, it's heaviest
  // where the stamp first contacts the page and thins out toward the rim.
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  const cx = size / 2;
  const cy = size / 2;
  const speckleRadius = 250;
  for (let i = 0; i < 420; i++) {
    const angle = Math.random() * Math.PI * 2;
    // Biased toward the outer half of the stamp's footprint.
    const dist = speckleRadius * (0.35 + Math.random() * 0.65);
    const sx = cx + Math.cos(angle) * dist;
    const sy = cy + Math.sin(angle) * dist;
    const r = 1 + Math.random() * 4;
    ctx.globalAlpha = 0.35 + Math.random() * 0.5;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  return canvas.toDataURL("image/png");
}
