import { NextResponse } from "next/server";
import { requireStatementUser, loadOwnImport, loadCategoryContext, notFound } from "@/lib/statement-server";
import { extractStatementChunk, StatementExtractError } from "@/lib/statement-gemini";
import { ChunkValidationError, sanitizeChunk } from "@/lib/statement-lines";
import {
  STATEMENT_CHUNK_MAX_ATTEMPTS,
  STATEMENT_CHUNK_MAX_BYTES,
  STATEMENT_MAX_LINES,
} from "@/lib/statement-config";
import type { Json } from "@/lib/database.types";

export const runtime = "nodejs";
// One chunk is a few pages; this is the same ceiling the receipt route uses.
export const maxDuration = 60;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

// Reads one chunk of the statement and saves its lines. The file is read into
// memory, sent to Gemini and dropped - never written to storage. A failure is
// recorded against this chunk only (fail_chunk), so the other chunks' results
// are untouched and just this one can be retried.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  const { ctx } = auth;

  const { id, n } = await params;
  const chunkNo = Number(n);
  if (!Number.isInteger(chunkNo) || chunkNo < 1) return notFound();

  const imp = await loadOwnImport(ctx, id);
  if (!imp) return notFound();
  if (imp.status !== "draft") {
    return NextResponse.json({ error: "This import is no longer open.", code: "IMPORT_NOT_OPEN" }, { status: 409 });
  }

  const { data: chunks } = await ctx.supabase
    .from("statement_chunks")
    .select("*")
    .eq("import_id", id)
    .order("chunk_no", { ascending: true });
  const chunk = chunks?.find((c) => c.chunk_no === chunkNo);
  if (!chunk || !chunks) return notFound();

  // Idempotent: a double-submit of a finished chunk is a no-op, not a second bill.
  if (chunk.status === "done") {
    return NextResponse.json({ chunk_no: chunkNo, already_done: true });
  }
  if (chunk.attempts >= STATEMENT_CHUNK_MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "These pages couldn't be read after several tries. Discard this import and try a clearer copy.", code: "TOO_MANY_ATTEMPTS" },
      { status: 429 },
    );
  }
  // Later chunks need the statement period that chunk 1's header supplies, to
  // put the right year on dates like "Mar 14".
  if (chunkNo > 1 && chunks[0]?.status !== "done") {
    return NextResponse.json(
      { error: "Read the first pages before the rest.", code: "CHUNK_ONE_FIRST" },
      { status: 409 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided under the 'file' field." }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 });
  }
  if (file.size > STATEMENT_CHUNK_MAX_BYTES + 256 * 1024) {
    return NextResponse.json({ error: "That part of the statement is too large to send." }, { status: 413 });
  }

  const [{ options: categories, bankChargesCategory }, { count: otherLines }] = await Promise.all([
    loadCategoryContext(ctx),
    ctx.supabase
      .from("statement_lines")
      .select("id", { count: "exact", head: true })
      .eq("import_id", id)
      .neq("chunk_id", chunk.id),
  ]);

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const result = await extractStatementChunk(base64, file.type, {
      today: new Date().toISOString().slice(0, 10),
      pageCount: chunk.page_to - chunk.page_from + 1,
      periodStart: imp.period_start,
      periodEnd: imp.period_end,
      categories,
      bankChargesCategory,
    });
    inputTokens = result.inputTokens;
    outputTokens = result.outputTokens;

    const { lines, header } = sanitizeChunk(result.raw, {
      pageFrom: chunk.page_from,
      pageTo: chunk.page_to,
      today: new Date().toISOString().slice(0, 10),
      periodStart: imp.period_start,
      periodEnd: imp.period_end,
      allowedCategories: categories,
      bankChargesCategory,
    });
    if ((otherLines ?? 0) + lines.length > STATEMENT_MAX_LINES) {
      throw new ChunkValidationError(`A statement can have at most ${STATEMENT_MAX_LINES} lines.`);
    }

    const { error } = await ctx.admin.rpc("save_chunk_result", {
      p_user_id: ctx.user.id,
      p_import_id: id,
      p_chunk_no: chunkNo,
      p_lines: lines as unknown as Json,
      p_header: header as unknown as Json,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
    });
    if (error) throw error;

    return NextResponse.json({ chunk_no: chunkNo, lines: lines.length });
  } catch (err) {
    let code = "UNKNOWN";
    let status = 500;
    let message = "Something went wrong reading these pages. Please try again.";

    if (err instanceof StatementExtractError) {
      code = err.code;
      status = err.httpStatus;
      message = err.message;
      inputTokens = err.inputTokens;
      outputTokens = err.outputTokens;
    } else if (err instanceof ChunkValidationError) {
      code = err.code;
      status = 502;
      message = "We couldn't read these pages reliably. Try again, or use a clearer copy.";
    }

    // Deliberately no statement content and no user id: the chunk's number and
    // the failure code are enough to tell a busy provider from a bad read.
    console.error("[statements] chunk failed", { chunk_no: chunkNo, code, status });

    await ctx.admin.rpc("fail_chunk", {
      p_user_id: ctx.user.id,
      p_import_id: id,
      p_chunk_no: chunkNo,
      p_error_code: code,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
    });

    return NextResponse.json({ error: message, code, chunk_no: chunkNo }, { status });
  }
}
