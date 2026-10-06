import {
  STATEMENT_CHUNK_MAX_BYTES,
  STATEMENT_CHUNK_PAGES,
  STATEMENT_MAX_PAGES,
  STATEMENT_WHOLE_FILE_MAX_PAGES,
} from "./statement-config.ts";
import { planChunks, type ChunkRange } from "./statement-chunks.ts";

// Browser-side preparation of a statement PDF: split it into page chunks, or - if
// it can't be split - decide whether it can be sent whole. No DOM and no alias
// imports, so it is unit-tested directly under `node --test`.

export class StatementFileError extends Error {}

export interface PreparedStatement {
  kind: "pdf" | "images";
  /** "split" = the normal page chunks; "whole" = the file sent as one chunk because it can't be split. */
  mode: "split" | "whole";
  /** SHA-256 of the file's bytes (images: of all of them, in selection order). */
  sha256: string;
  pageCount: number;
  /** The chunk plan to propose for a brand-new import. */
  defaultPlan: ChunkRange[];
  /** The slice of the file for one chunk of a plan (the plan the server holds). */
  slice(range: ChunkRange): Promise<File>;
  /**
   * What to tell the user if the server rejects a whole-file send as unreadable.
   * Set only in "whole" mode, where we already know why the file couldn't be split.
   */
  unreadableMessage?: string;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

// ---------------------------------------------------------------------------
// Why couldn't pdf-lib open it?
// ---------------------------------------------------------------------------

export type PdfFailureKind = "encrypted" | "malformed";

// pdf-lib's errors are all plain `Error` instances (its build breaks `instanceof`
// for its own subclasses - `e instanceof EncryptedPDFError` is false for a real
// encrypted file), so the message is the only reliable signal. It's pinned by a
// test against a genuinely encrypted PDF so a pdf-lib upgrade that rewords it
// fails loudly instead of silently mislabeling every encrypted file "damaged".
export function classifyPdfError(err: unknown): PdfFailureKind {
  const message = err instanceof Error ? err.message : String(err);
  return /is encrypted/i.test(message) ? "encrypted" : "malformed";
}

// A cheap page count for a file pdf-lib can't parse: count page objects in the
// raw bytes. Only trustworthy as a lower bound - a PDF that keeps its page
// objects inside compressed streams counts as 0 - so callers treat 0 as "unknown".
export function countPdfPagesHeuristic(bytes: Uint8Array): number {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
}

export function hasPdfHeader(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

// Can a PDF we couldn't split still be sent as one chunk? Only if it fits in a
// request, and we know it has few enough pages that its lines fit in one reply.
export type WholeFileDecision =
  | { ok: true; pages: number }
  | { ok: false; reason: "too_large" | "too_many_pages" | "unknown_pages" };

export function decideWholeFile(sizeBytes: number, pages: number | null): WholeFileDecision {
  if (sizeBytes > STATEMENT_CHUNK_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (pages === null || pages < 1) return { ok: false, reason: "unknown_pages" };
  if (pages > STATEMENT_WHOLE_FILE_MAX_PAGES) return { ok: false, reason: "too_many_pages" };
  return { ok: true, pages };
}

const UNPROTECTED_COPY_HINT =
  "Open it, choose Print, and save it as a new PDF (or download an unprotected copy from your bank), then import that one.";

export function unreadablePdfMessage(kind: PdfFailureKind): string {
  return kind === "encrypted"
    ? `This PDF is password-protected, so it can't be read. ${UNPROTECTED_COPY_HINT}`
    : `This PDF looks damaged or isn't a normal PDF, so it can't be read. Download it again from your bank, or open it, choose Print, and save a new PDF, then import that one.`;
}

export function wholeFileRefusal(
  kind: PdfFailureKind,
  decision: Extract<WholeFileDecision, { ok: false }>,
  sizeBytes: number,
  pages: number | null,
): string {
  if (kind === "malformed") {
    // We never got a trustworthy page count, so there's nothing to send safely.
    return unreadablePdfMessage("malformed");
  }
  const lead = "This PDF is password-protected or copy-protected, so it can't be split into pages";
  switch (decision.reason) {
    case "too_large":
      return `${lead}, and at ${megabytes(sizeBytes)} MB it's too large to send whole (limit ${megabytes(STATEMENT_CHUNK_MAX_BYTES)} MB). ${UNPROTECTED_COPY_HINT}`;
    case "too_many_pages":
      return `${lead}, and at ${pages} pages it's too long to send whole (limit ${STATEMENT_WHOLE_FILE_MAX_PAGES} pages). ${UNPROTECTED_COPY_HINT}`;
    case "unknown_pages":
      return unreadablePdfMessage("encrypted");
  }
}

// ---------------------------------------------------------------------------
// Preparing a PDF
// ---------------------------------------------------------------------------

export async function preparePdfFile(file: File): Promise<PreparedStatement> {
  const { PDFDocument } = await import("pdf-lib");
  const bytes = new Uint8Array(await file.arrayBuffer());

  let source: Awaited<ReturnType<typeof PDFDocument.load>>;
  try {
    source = await PDFDocument.load(bytes);
  } catch (err) {
    return prepareWholeFile(file, bytes, err);
  }

  const pageCount = source.getPageCount();
  if (pageCount > STATEMENT_MAX_PAGES) {
    throw new StatementFileError(`That statement has ${pageCount} pages. The limit is ${STATEMENT_MAX_PAGES}.`);
  }

  const cache = new Map<string, File>();
  async function slice(range: ChunkRange): Promise<File> {
    const key = `${range.page_from}-${range.page_to}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const part = await PDFDocument.create();
    const indices = Array.from(
      { length: range.page_to - range.page_from + 1 },
      (_, i) => range.page_from - 1 + i,
    );
    for (const page of await part.copyPages(source, indices)) part.addPage(page);
    const out = await part.save();
    const copy = new File([new Uint8Array(out)], `statement-pages-${key}.pdf`, { type: "application/pdf" });
    if (copy.size > STATEMENT_CHUNK_MAX_BYTES) {
      throw new StatementFileError(
        range.page_from === range.page_to
          ? `Page ${range.page_from} is ${megabytes(copy.size)} MB, which is too large to send. Export a smaller copy from your bank.`
          : `Pages ${range.page_from}-${range.page_to} are too large to send together.`,
      );
    }
    cache.set(key, copy);
    return copy;
  }

  // Three pages per chunk, unless a scanned PDF's pages are heavy enough that a
  // chunk would exceed the request-size limit - then one page per chunk.
  let defaultPlan = planChunks(pageCount, STATEMENT_CHUNK_PAGES);
  try {
    for (const range of defaultPlan) await slice(range);
  } catch {
    cache.clear();
    defaultPlan = planChunks(pageCount, 1);
    for (const range of defaultPlan) await slice(range); // throws a clear error if a page alone is too big
  }

  return { kind: "pdf", mode: "split", sha256: await sha256Hex(file), pageCount, defaultPlan, slice };
}

// pdf-lib couldn't open the file, so it can't be split. If it is small enough to
// send as one request and its page count is known to fit one reply, send it whole
// - Gemini reads some files pdf-lib refuses (notably PDFs encrypted with an owner
// password only, which many banks use). Otherwise it is refused here, with the
// real reason: password-protected, or damaged.
async function prepareWholeFile(file: File, bytes: Uint8Array, cause: unknown): Promise<PreparedStatement> {
  const kind = classifyPdfError(cause);

  let pages: number | null = null;
  if (kind === "encrypted") {
    // pdf-lib can still read the page tree of most encrypted files, it just can't
    // copy their (encrypted) page content - fine for counting.
    try {
      const { PDFDocument } = await import("pdf-lib");
      pages = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
    } catch {
      pages = null;
    }
  } else if (hasPdfHeader(bytes)) {
    const counted = countPdfPagesHeuristic(bytes);
    pages = counted > 0 ? counted : null;
  }

  const decision = decideWholeFile(file.size, pages);
  if (!decision.ok) {
    throw new StatementFileError(wholeFileRefusal(kind, decision, file.size, pages), { cause });
  }

  const range: ChunkRange = { page_from: 1, page_to: decision.pages };
  return {
    kind: "pdf",
    mode: "whole",
    sha256: await sha256Hex(file),
    pageCount: decision.pages,
    defaultPlan: [range],
    async slice(requested) {
      if (requested.page_from !== 1 || requested.page_to !== decision.pages) {
        throw new StatementFileError("This PDF can only be read as a single piece.");
      }
      return file;
    },
    unreadableMessage: unreadablePdfMessage(kind),
  };
}
