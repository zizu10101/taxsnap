import {
  DISPLAY_MAX_EDGE,
  DISPLAY_QUALITIES,
  DISPLAY_TARGET_BYTES,
  MAX_SHRINKS,
  SHRINK_FACTOR,
  THUMB_MAX_EDGE,
  THUMB_QUALITIES,
  THUMB_TARGET_BYTES,
} from "./photo-config.ts";

// The browser-free half of photo compression: how big to draw, and how to step quality down until the
// file fits. The canvas work lives in photo-compress.ts and is passed in as `encode`, so this runs
// (and is tested) in node.

// Scale so the LONG edge is at most maxEdge. Never scales up. Always at least 1 px.
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 1, height: 1 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface FitResult {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
  // False when even the smallest attempt was over budget (the smallest is returned anyway).
  withinBudget: boolean;
}

// Encodes at each quality in order until the result is within `targetBytes`. If none fits, shrinks the
// long edge by SHRINK_FACTOR (up to MAX_SHRINKS times) and tries the ladder again. Returns the first
// that fits, else the smallest it saw.
export async function encodeWithinBudget(
  width: number,
  height: number,
  opts: { maxEdge: number; targetBytes: number; qualities: readonly number[] },
  encode: (size: { width: number; height: number }, quality: number) => Promise<Blob>,
): Promise<FitResult> {
  let edge = opts.maxEdge;
  let smallest: FitResult | null = null;
  for (let attempt = 0; attempt <= MAX_SHRINKS; attempt++) {
    const size = fitWithin(width, height, edge);
    for (const quality of opts.qualities) {
      const blob = await encode(size, quality);
      const result: FitResult = { blob, ...size, quality, withinBudget: blob.size <= opts.targetBytes };
      if (result.withinBudget) return result;
      if (!smallest || blob.size < smallest.blob.size) smallest = result;
    }
    edge = Math.round(edge * SHRINK_FACTOR);
  }
  return smallest!;
}

export function encodeDisplay(
  width: number,
  height: number,
  encode: (size: { width: number; height: number }, quality: number) => Promise<Blob>,
): Promise<FitResult> {
  return encodeWithinBudget(
    width,
    height,
    { maxEdge: DISPLAY_MAX_EDGE, targetBytes: DISPLAY_TARGET_BYTES, qualities: DISPLAY_QUALITIES },
    encode,
  );
}

export function encodeThumbnail(
  width: number,
  height: number,
  encode: (size: { width: number; height: number }, quality: number) => Promise<Blob>,
): Promise<FitResult> {
  return encodeWithinBudget(
    width,
    height,
    { maxEdge: THUMB_MAX_EDGE, targetBytes: THUMB_TARGET_BYTES, qualities: THUMB_QUALITIES },
    encode,
  );
}
