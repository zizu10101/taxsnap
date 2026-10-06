import assert from "node:assert/strict";
import test from "node:test";
import { jsPDF } from "jspdf";
import { PDFDocument } from "pdf-lib";
import {
  classifyPdfError,
  countPdfPagesHeuristic,
  decideWholeFile,
  hasPdfHeader,
  preparePdfFile,
  sha256Hex,
  StatementFileError,
  unreadablePdfMessage,
} from "./statement-pdf.ts";
import { STATEMENT_CHUNK_MAX_BYTES, STATEMENT_WHOLE_FILE_MAX_PAGES } from "./statement-config.ts";

// Real PDFs, built with jsPDF (which can genuinely encrypt) - not mocks, because
// the point is to pin how pdf-lib actually reacts to an encrypted file.

type Encryption = { userPassword: string; ownerPassword: string; userPermissions: ["print"] };
const OWNER_ONLY: Encryption = { userPassword: "", ownerPassword: "owner-secret", userPermissions: ["print"] };
const USER_PASSWORD: Encryption = { userPassword: "open-sesame", ownerPassword: "owner-secret", userPermissions: ["print"] };

function makePdf(pages: number, encryption?: Encryption): Buffer {
  const doc = new jsPDF(encryption ? { encryption } : {});
  for (let i = 1; i <= pages; i++) {
    if (i > 1) doc.addPage();
    doc.text(`Aug ${i}  TEST MERCHANT ${i}   ${i}0.00`, 10, 20);
  }
  return Buffer.from(doc.output("arraybuffer"));
}
const asFile = (bytes: Buffer, name = "statement.pdf") =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

async function loadError(bytes: Buffer): Promise<unknown> {
  try {
    await PDFDocument.load(bytes);
  } catch (err) {
    return err;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Which error is it? (the "couldn't open that PDF" diagnosis)
// ---------------------------------------------------------------------------

test("a real encrypted PDF is classified 'encrypted' (pdf-lib's own error is a plain Error, so only its message tells)", async () => {
  for (const enc of [OWNER_ONLY, USER_PASSWORD]) {
    const err = await loadError(makePdf(2, enc));
    assert.ok(err instanceof Error, "pdf-lib should refuse to load an encrypted PDF");
    assert.match((err as Error).message, /is encrypted/i);
    assert.equal(classifyPdfError(err), "encrypted");
  }
});

test("a damaged PDF and a non-PDF are classified 'malformed', not 'encrypted'", async () => {
  const plain = makePdf(2);
  const truncated = plain.subarray(0, Math.floor(plain.length * 0.6));
  const garbage = Buffer.from("this is definitely not a pdf ".repeat(50));
  for (const bytes of [truncated, garbage]) {
    const err = await loadError(bytes);
    assert.ok(err instanceof Error);
    assert.equal(classifyPdfError(err), "malformed");
  }
});

test("the two cases get different user-facing messages", () => {
  assert.match(unreadablePdfMessage("encrypted"), /password-protected/);
  assert.doesNotMatch(unreadablePdfMessage("malformed"), /password/);
  assert.match(unreadablePdfMessage("malformed"), /damaged/);
});

// ---------------------------------------------------------------------------
// The whole-file fallback
// ---------------------------------------------------------------------------

test("an encrypted PDF that can't be split is sent whole, as one chunk covering every page", async () => {
  const bytes = makePdf(2, OWNER_ONLY);
  const file = asFile(bytes);
  const prepared = await preparePdfFile(file);

  assert.equal(prepared.mode, "whole");
  assert.equal(prepared.pageCount, 2);
  assert.deepEqual(prepared.defaultPlan, [{ page_from: 1, page_to: 2 }]);
  assert.equal(prepared.sha256, await sha256Hex(file));
  assert.match(prepared.unreadableMessage ?? "", /password-protected/);

  // The chunk is the original file, byte for byte.
  const sent = await prepared.slice({ page_from: 1, page_to: 2 });
  assert.deepEqual(Buffer.from(await sent.arrayBuffer()), bytes);
  // Anything other than the whole range is refused rather than silently mis-sliced.
  await assert.rejects(prepared.slice({ page_from: 1, page_to: 1 }), StatementFileError);
});

test("a user-password PDF looks identical before sending, so it also goes whole (the reader's rejection is what reports it)", async () => {
  const prepared = await preparePdfFile(asFile(makePdf(2, USER_PASSWORD)));
  assert.equal(prepared.mode, "whole");
  assert.match(prepared.unreadableMessage ?? "", /password-protected/);
});

test("an encrypted PDF over the request limit is refused with the password-protected reason, not 'unreadable'", async () => {
  const big = Buffer.concat([makePdf(2, OWNER_ONLY), Buffer.alloc(STATEMENT_CHUNK_MAX_BYTES + 1024, 0x25)]);
  await assert.rejects(preparePdfFile(asFile(big)), (err: unknown) => {
    assert.ok(err instanceof StatementFileError);
    assert.match(err.message, /password-protected or copy-protected/);
    assert.match(err.message, /too large/);
    return true;
  });
});

test("an encrypted PDF with more pages than one reply can hold is refused, naming the page limit", async () => {
  const tooMany = STATEMENT_WHOLE_FILE_MAX_PAGES + 1;
  await assert.rejects(preparePdfFile(asFile(makePdf(tooMany, OWNER_ONLY))), (err: unknown) => {
    assert.ok(err instanceof StatementFileError);
    assert.match(err.message, /password-protected or copy-protected/);
    assert.match(err.message, new RegExp(`${tooMany} pages`));
    return true;
  });
});

test("a PDF at exactly the whole-file page limit is still accepted", async () => {
  const prepared = await preparePdfFile(asFile(makePdf(STATEMENT_WHOLE_FILE_MAX_PAGES, OWNER_ONLY)));
  assert.equal(prepared.mode, "whole");
  assert.equal(prepared.pageCount, STATEMENT_WHOLE_FILE_MAX_PAGES);
});

test("a file that isn't a PDF at all is refused as unreadable - never as password-protected", async () => {
  const garbage = Buffer.from("this is definitely not a pdf ".repeat(50));
  await assert.rejects(preparePdfFile(asFile(garbage)), (err: unknown) => {
    assert.ok(err instanceof StatementFileError);
    assert.match(err.message, /damaged/);
    assert.doesNotMatch(err.message, /password/);
    // The underlying pdf-lib error rides along for the console log.
    assert.ok(err.cause instanceof Error);
    assert.match((err.cause as Error).message, /No PDF header found/);
    return true;
  });
});

test("a PDF whose header is cut off is unreadable even though it still has page objects", async () => {
  const cut = makePdf(2).subarray(20);
  assert.equal(hasPdfHeader(cut), false);
  await assert.rejects(preparePdfFile(asFile(cut)), /damaged/);
});

test("a damaged PDF with countable pages is sent whole instead of being rejected up front", async () => {
  const plain = makePdf(2);
  const truncated = plain.subarray(0, Math.floor(plain.length * 0.6));
  assert.ok(hasPdfHeader(truncated));
  const pages = countPdfPagesHeuristic(truncated);
  const prepared = await preparePdfFile(asFile(truncated)).catch((e: unknown) => e);
  if (pages > 0) {
    assert.equal((prepared as Awaited<ReturnType<typeof preparePdfFile>>).mode, "whole");
    assert.match((prepared as Awaited<ReturnType<typeof preparePdfFile>>).unreadableMessage ?? "", /damaged/);
  } else {
    assert.ok(prepared instanceof StatementFileError);
  }
});

// ---------------------------------------------------------------------------
// Unchanged behaviour, and the pure decision
// ---------------------------------------------------------------------------

test("a normal PDF is still split into page chunks", async () => {
  const prepared = await preparePdfFile(asFile(makePdf(7)));
  assert.equal(prepared.mode, "split");
  assert.equal(prepared.pageCount, 7);
  assert.deepEqual(prepared.defaultPlan, [
    { page_from: 1, page_to: 3 },
    { page_from: 4, page_to: 6 },
    { page_from: 7, page_to: 7 },
  ]);
  const middle = await prepared.slice({ page_from: 4, page_to: 6 });
  assert.equal((await PDFDocument.load(await middle.arrayBuffer())).getPageCount(), 3);
});

test("decideWholeFile: size, page count and unknown page count", () => {
  assert.deepEqual(decideWholeFile(1000, 4), { ok: true, pages: 4 });
  assert.deepEqual(decideWholeFile(STATEMENT_CHUNK_MAX_BYTES, STATEMENT_WHOLE_FILE_MAX_PAGES), { ok: true, pages: STATEMENT_WHOLE_FILE_MAX_PAGES });
  assert.deepEqual(decideWholeFile(STATEMENT_CHUNK_MAX_BYTES + 1, 2), { ok: false, reason: "too_large" });
  assert.deepEqual(decideWholeFile(1000, STATEMENT_WHOLE_FILE_MAX_PAGES + 1), { ok: false, reason: "too_many_pages" });
  assert.deepEqual(decideWholeFile(1000, null), { ok: false, reason: "unknown_pages" });
  assert.deepEqual(decideWholeFile(1000, 0), { ok: false, reason: "unknown_pages" });
});
