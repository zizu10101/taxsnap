import { compressImage } from "@/lib/compress-image";
import { planChunks, type ChunkRange } from "@/lib/statement-chunks";
import {
  preparePdfFile,
  sha256Hex,
  StatementFileError,
  type PreparedStatement,
} from "@/lib/statement-pdf";
import {
  STATEMENT_CHUNK_MAX_BYTES,
  STATEMENT_MAX_FILE_BYTES,
  STATEMENT_MAX_PAGES,
} from "@/lib/statement-config";

// Browser-only. Prepares a statement file for import (fingerprint + page chunks)
// and drives the per-chunk extraction calls. The file is held in memory only:
// it is never uploaded to storage, and only these small page chunks are posted.
// PDF handling lives in statement-pdf.ts (so it can be unit-tested in node).

export { sha256Hex, StatementFileError };
export type { PreparedStatement };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export async function prepareStatement(files: File[]): Promise<PreparedStatement> {
  if (files.length === 0) throw new StatementFileError("Choose a statement file first.");
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > STATEMENT_MAX_FILE_BYTES) {
    throw new StatementFileError(
      `That file is ${megabytes(total)} MB. The limit is ${megabytes(STATEMENT_MAX_FILE_BYTES)} MB.`,
    );
  }

  const pdfs = files.filter((f) => f.type === "application/pdf");
  if (pdfs.length > 0) {
    if (files.length > 1) {
      throw new StatementFileError("Choose either one PDF or several photos, not both.");
    }
    try {
      return await preparePdfFile(files[0]);
    } catch (err) {
      // The user sees a plain-language message; the real pdf-lib error goes to
      // the console so "couldn't open that PDF" is never a mystery again. It
      // holds pdf-lib's wording only, never the file's contents.
      if (err instanceof StatementFileError && err.cause instanceof Error) {
        console.warn("[statement] PDF could not be prepared:", err.cause.message);
      }
      throw err;
    }
  }
  if (files.some((f) => !IMAGE_TYPES.has(f.type))) {
    throw new StatementFileError("Statements must be a PDF or photos (JPG, PNG, WebP or HEIC).");
  }
  return prepareImages(files);
}

async function prepareImages(files: File[]): Promise<PreparedStatement> {
  if (files.length > STATEMENT_MAX_PAGES) {
    throw new StatementFileError(`That's ${files.length} photos. The limit is ${STATEMENT_MAX_PAGES}.`);
  }
  const cache = new Map<number, File>();
  async function slice(range: ChunkRange): Promise<File> {
    if (range.page_from !== range.page_to) {
      throw new StatementFileError("Photos are read one at a time.");
    }
    const index = range.page_from - 1;
    const hit = cache.get(index);
    if (hit) return hit;
    // Statements are dense small print, so keep more resolution than a receipt photo.
    const original = files[index];
    const compressed = await compressImage(original, { maxWidth: 2000, quality: 0.88 }).catch(() => original);
    if (compressed.size > STATEMENT_CHUNK_MAX_BYTES) {
      throw new StatementFileError(`Photo ${range.page_from} is too large to send. Try a smaller photo.`);
    }
    cache.set(index, compressed);
    return compressed;
  }

  return {
    kind: "images",
    mode: "split",
    sha256: await sha256Hex(new Blob(files)),
    pageCount: files.length,
    defaultPlan: planChunks(files.length, 1),
    slice,
  };
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export interface ChunkPlanRow extends ChunkRange {
  chunk_no: number;
  status: "pending" | "done" | "failed";
  attempts: number;
  error_code: string | null;
}

export class StatementApiError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status: number,
    // The rest of the response body (e.g. what ALREADY_IMPORTED knows about the saved import).
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function apiError(res: Response, data: Record<string, unknown>, fallback: string): StatementApiError {
  return new StatementApiError(
    typeof data.error === "string" ? data.error : fallback,
    typeof data.code === "string" ? data.code : undefined,
    res.status,
    data,
  );
}

export async function startImport(
  accountId: string,
  prepared: PreparedStatement,
  // The saved import to retire first (Re-import): only valid for that import's own file.
  options: { reimportOf?: string } = {},
): Promise<{ importId: string; resumed: boolean; chunks: ChunkPlanRow[] }> {
  const res = await fetch("/api/statements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account_id: accountId,
      file_sha256: prepared.sha256,
      page_count: prepared.pageCount,
      chunks: prepared.defaultPlan,
      ...(options.reimportOf && { reimport_of: options.reimportOf }),
    }),
  });
  const data = await readJson(res);
  if (!res.ok) throw apiError(res, data, "Couldn't start the import.");
  return {
    importId: data.import_id as string,
    resumed: data.resumed === true,
    chunks: (data.chunks as ChunkPlanRow[]) ?? [],
  };
}

export async function finalizeImport(importId: string): Promise<void> {
  const res = await fetch(`/api/statements/${importId}/finalize`, { method: "POST" });
  if (!res.ok) throw apiError(res, await readJson(res), "Couldn't finish reading the statement.");
}

// ---------------------------------------------------------------------------
// Running chunks
// ---------------------------------------------------------------------------

export type ChunkRunState =
  | { status: "running" }
  | { status: "done" }
  | { status: "failed"; message: string; code?: string; retryable: boolean };

const AUTO_RETRY_DELAYS_MS = [1500, 4000]; // two automatic retries per run
const CONCURRENCY = 3;

// A file the reader rejected outright won't read any better the next time.
const NEVER_RETRY = new Set(["TOO_MANY_ATTEMPTS", "IMPORT_NOT_OPEN", "UNREADABLE_FILE"]);

function isRetryable(err: StatementApiError): boolean {
  // Provider trouble and network blips; never a 4xx that retrying can't fix.
  if (err.status === 0) return true;
  if (err.code && NEVER_RETRY.has(err.code)) return false;
  return err.status === 429 || err.status >= 500;
}

async function postChunk(importId: string, chunkNo: number, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  let res: Response;
  try {
    res = await fetch(`/api/statements/${importId}/chunks/${chunkNo}`, { method: "POST", body: form });
  } catch {
    throw new StatementApiError("Network problem. Check your connection and retry.", undefined, 0);
  }
  if (!res.ok) throw apiError(res, await readJson(res), "Couldn't read these pages.");
}

async function runOne(
  importId: string,
  row: ChunkPlanRow,
  prepared: PreparedStatement,
  onUpdate: (chunkNo: number, state: ChunkRunState) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  onUpdate(row.chunk_no, { status: "running" });
  try {
    const file = await prepared.slice(row);
    for (let attempt = 0; ; attempt++) {
      try {
        await postChunk(importId, row.chunk_no, file);
        onUpdate(row.chunk_no, { status: "done" });
        return true;
      } catch (err) {
        const apiErr = err instanceof StatementApiError ? err : new StatementApiError("Something went wrong.", undefined, 0);
        const delay = AUTO_RETRY_DELAYS_MS[attempt];
        if (!isRetryable(apiErr) || delay === undefined || signal?.aborted) throw apiErr;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  } catch (err) {
    const apiErr = err instanceof StatementApiError ? err : null;
    // A whole-file send that the reader rejected: we already know why the file
    // couldn't be split (password-protected vs damaged), so say that instead of
    // a generic failure.
    const message =
      apiErr?.code === "UNREADABLE_FILE" && prepared.unreadableMessage
        ? prepared.unreadableMessage
        : err instanceof Error
          ? err.message
          : "Couldn't read these pages.";
    onUpdate(row.chunk_no, {
      status: "failed",
      message,
      code: apiErr?.code,
      retryable: apiErr ? !(apiErr.code && NEVER_RETRY.has(apiErr.code)) : true,
    });
    return false;
  }
}

// Runs every chunk that isn't done yet. Chunk 1 goes first and alone - its
// header gives the statement period the later chunks need - then the rest run
// three at a time. A failure never stops or discards the others; the caller
// retries just the failed chunks by calling this again with the same plan.
// Returns whether every chunk in the plan is now done.
export async function runChunks(
  importId: string,
  plan: ChunkPlanRow[],
  prepared: PreparedStatement,
  onUpdate: (chunkNo: number, state: ChunkRunState) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const todo = plan.filter((c) => c.status !== "done").sort((a, b) => a.chunk_no - b.chunk_no);
  if (todo.length === 0) return true;

  const first = plan.find((c) => c.chunk_no === 1);
  let rest = todo;
  if (first && first.status !== "done") {
    const ok = await runOne(importId, first, prepared, onUpdate, signal);
    if (!ok) return false; // the rest can't be read without chunk 1's period
    rest = todo.filter((c) => c.chunk_no !== 1);
  }

  let allOk = true;
  let next = 0;
  async function worker() {
    while (next < rest.length && !signal?.aborted) {
      const row = rest[next++];
      if (!(await runOne(importId, row, prepared, onUpdate, signal))) allOk = false;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rest.length) }, worker));
  return allOk;
}
