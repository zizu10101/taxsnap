import { STATEMENT_CHUNK_PAGES, STATEMENT_MAX_PAGES } from "./statement-config.ts";

export interface ChunkRange {
  page_from: number;
  page_to: number;
}

// Splits `pageCount` pages into consecutive ranges of at most `perChunk`.
export function planChunks(pageCount: number, perChunk = STATEMENT_CHUNK_PAGES): ChunkRange[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) return [];
  const size = Math.max(1, Math.floor(perChunk));
  const ranges: ChunkRange[] = [];
  for (let from = 1; from <= pageCount; from += size) {
    ranges.push({ page_from: from, page_to: Math.min(pageCount, from + size - 1) });
  }
  return ranges;
}

// Server-side check of a chunk plan the client proposed: contiguous from page 1
// to the last page, no gaps or overlaps, and within the page cap. Returns an
// error message, or null when the plan is valid.
export function validateChunkPlan(pageCount: unknown, chunks: unknown): string | null {
  if (!Number.isInteger(pageCount) || (pageCount as number) < 1) {
    return "page_count must be a positive whole number.";
  }
  const pages = pageCount as number;
  if (pages > STATEMENT_MAX_PAGES) {
    return `Statements are limited to ${STATEMENT_MAX_PAGES} pages.`;
  }
  if (!Array.isArray(chunks) || chunks.length === 0 || chunks.length > pages) {
    return "chunks must list every page range.";
  }
  let expectedFrom = 1;
  for (const c of chunks) {
    const from = (c as ChunkRange)?.page_from;
    const to = (c as ChunkRange)?.page_to;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from !== expectedFrom || to < from) {
      return "chunks must be contiguous page ranges starting at page 1.";
    }
    expectedFrom = to + 1;
  }
  if (expectedFrom - 1 !== pages) {
    return "chunks must cover every page.";
  }
  return null;
}
