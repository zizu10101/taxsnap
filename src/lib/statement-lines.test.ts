import assert from "node:assert/strict";
import test from "node:test";
import {
  ChunkValidationError,
  maskCardNumbers,
  sanitizeChunk,
  type SanitizeContext,
} from "./statement-lines.ts";

const ctx: SanitizeContext = {
  pageFrom: 4,
  pageTo: 6,
  today: "2026-10-05",
  periodStart: "2026-08-15",
  periodEnd: "2026-09-14",
  allowedCategories: ["Supplies", "Meals", "Bank charges", "Other"],
};

function line(overrides: Record<string, unknown> = {}) {
  return {
    page_in_chunk: 1,
    date: "2026-08-20",
    description: "HOME DEPOT #7042",
    amount: 48.2,
    kind: "purchase",
    currency: "CAD",
    suggested_category: "supplies",
    ...overrides,
  };
}

test("a normal line maps to an absolute page and a canonical category", () => {
  const { lines } = sanitizeChunk({ lines: [line()] }, ctx);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].page, 4);
  assert.equal(lines[0].line_no, 1);
  assert.equal(lines[0].amount, 48.2);
  assert.equal(lines[0].suggested_category, "Supplies");
});

test("page_in_chunk maps onto the chunk's page range and line_no counts per page", () => {
  const { lines } = sanitizeChunk(
    { lines: [line(), line({ page_in_chunk: 3 }), line({ page_in_chunk: 3, amount: 5 })] },
    ctx,
  );
  assert.deepEqual(lines.map((l) => [l.page, l.line_no]), [[4, 1], [6, 1], [6, 2]]);
});

test("a page outside the chunk fails the chunk", () => {
  assert.throws(() => sanitizeChunk({ lines: [line({ page_in_chunk: 4 })] }, ctx), ChunkValidationError);
  assert.throws(() => sanitizeChunk({ lines: [line({ page_in_chunk: 0 })] }, ctx), ChunkValidationError);
});

test("an unreadable date, amount or kind fails the whole chunk instead of dropping the line", () => {
  assert.throws(() => sanitizeChunk({ lines: [line({ date: "Mar 14" })] }, ctx), ChunkValidationError);
  assert.throws(() => sanitizeChunk({ lines: [line({ date: "2026-02-31" })] }, ctx), ChunkValidationError);
  assert.throws(() => sanitizeChunk({ lines: [line({ amount: "abc" })] }, ctx), ChunkValidationError);
  assert.throws(() => sanitizeChunk({ lines: [line({ kind: "gift" })] }, ctx), ChunkValidationError);
  assert.throws(() => sanitizeChunk({ lines: [line({ description: "  " })] }, ctx), ChunkValidationError);
});

test("a date far outside the period (a misread year) or in the future is rejected", () => {
  assert.throws(() => sanitizeChunk({ lines: [line({ date: "2025-08-20" })] }, ctx), ChunkValidationError);
  assert.throws(
    () => sanitizeChunk({ lines: [line({ date: "2026-12-01" })] }, { ...ctx, periodStart: null, periodEnd: null }),
    ChunkValidationError,
  );
  // A charge just before the period start still posts inside it.
  assert.doesNotThrow(() => sanitizeChunk({ lines: [line({ date: "2026-08-02" })] }, ctx));
});

test("the chunk's own header supplies the period when none is known yet", () => {
  const raw = { header: { period_start: "2026-08-15", period_end: "2026-09-14" }, lines: [line({ date: "2024-01-01" })] };
  assert.throws(() => sanitizeChunk(raw, { ...ctx, periodStart: null, periodEnd: null }), ChunkValidationError);
});

test("payments and refunds are always credits; a negative purchase becomes a refund", () => {
  const { lines } = sanitizeChunk(
    {
      lines: [
        line({ kind: "payment", amount: 500, description: "PAYMENT THANK YOU" }),
        line({ kind: "refund", amount: 12.5 }),
        line({ kind: "purchase", amount: -7.25 }),
      ],
    },
    ctx,
  );
  assert.deepEqual(lines.map((l) => [l.kind, l.amount]), [["payment", -500], ["refund", -12.5], ["refund", -7.25]]);
});

test("fees and interest get a Bank charges suggestion; payments get none", () => {
  const { lines } = sanitizeChunk(
    {
      lines: [
        line({ kind: "interest", amount: 18.4, suggested_category: null }),
        line({ kind: "fee", amount: 120, suggested_category: "Meals" }),
        line({ kind: "payment", amount: 50, suggested_category: "Supplies" }),
      ],
    },
    ctx,
  );
  assert.equal(lines[0].suggested_category, "Bank charges");
  assert.equal(lines[1].suggested_category, "Meals");
  assert.equal(lines[2].suggested_category, null);
});

test("a suggestion outside the allowed list is dropped, not invented", () => {
  const { lines } = sanitizeChunk({ lines: [line({ suggested_category: "Yacht" })] }, ctx);
  assert.equal(lines[0].suggested_category, null);
});

test("zero-dollar lines are ignored", () => {
  assert.equal(sanitizeChunk({ lines: [line({ amount: 0 })] }, ctx).lines.length, 0);
});

test("foreign-currency detail is kept only when it is complete", () => {
  const ok = sanitizeChunk({ lines: [line({ original_amount: 30, original_currency: "usd" })] }, ctx).lines[0];
  assert.equal(ok.original_amount, 30);
  assert.equal(ok.original_currency, "USD");
  const partial = sanitizeChunk({ lines: [line({ original_amount: 30 })] }, ctx).lines[0];
  assert.equal(partial.original_amount, null);
  assert.equal(partial.original_currency, null);
});

test("card numbers in a description are masked to the last four digits", () => {
  assert.equal(maskCardNumbers("PAYMENT FROM 4520 1234 5678 9012"), "PAYMENT FROM ****9012");
  assert.equal(maskCardNumbers("REF 123456"), "REF 123456");
  const { lines } = sanitizeChunk({ lines: [line({ description: "XFER 4520123456789012" })] }, ctx);
  assert.equal(lines[0].description, "XFER ****9012");
});

test("header values are parsed; a total without a kind is discarded", () => {
  const { header } = sanitizeChunk(
    {
      header: {
        issuer: " Visa ",
        period_start: "2026-08-15",
        period_end: "2026-09-14",
        opening_balance: "$1,200.50",
        closing_balance: 980.1,
        statement_total: 400,
      },
      lines: [],
    },
    ctx,
  );
  assert.equal(header.issuer, "Visa");
  assert.equal(header.opening_balance, 1200.5);
  assert.equal(header.statement_total, null);
  assert.equal(header.statement_total_kind, null);
});

test("an inverted period in the header is discarded", () => {
  const { header } = sanitizeChunk(
    { header: { period_start: "2026-09-14", period_end: "2026-08-15" }, lines: [] },
    ctx,
  );
  assert.equal(header.period_start, null);
  assert.equal(header.period_end, null);
});

test("garbage input yields no lines rather than a crash", () => {
  assert.deepEqual(sanitizeChunk(null, ctx).lines, []);
  assert.deepEqual(sanitizeChunk({ lines: "x" }, ctx).lines, []);
});
