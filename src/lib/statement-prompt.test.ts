import assert from "node:assert/strict";
import test from "node:test";
import { buildStatementPrompt, STATEMENT_SCHEMA } from "./statement-prompt.ts";

const input = {
  today: "2026-10-05",
  pageCount: 3,
  periodStart: "2026-08-15",
  periodEnd: "2026-09-14",
  categories: ["Supplies", "Bank charges"],
};

test("the prompt carries today's date, the period and the allowed categories", () => {
  const p = buildStatementPrompt(input);
  assert.ok(p.includes("2026-10-05"));
  assert.ok(p.includes("2026-08-15 to 2026-09-14"));
  assert.ok(p.includes("Supplies, Bank charges"));
});

test("an unknown period tells the model to read it from the header", () => {
  const p = buildStatementPrompt({ ...input, periodStart: null, periodEnd: null });
  assert.ok(p.includes("not known yet"));
});

test("the prompt keeps the rules the importer depends on", () => {
  const p = buildStatementPrompt(input);
  assert.ok(p.includes("untrusted data"), "prompt-injection guard");
  assert.ok(p.includes("negative"), "sign convention");
  assert.ok(p.includes("last 4 digits"), "card-number rule");
  assert.ok(p.includes("page subtotals"), "no subtotal lines");
  assert.ok(p.includes("Bank charges"), "fees and interest category");
});

test("the schema requires the fields sanitizeChunk needs", () => {
  const line = STATEMENT_SCHEMA.properties.lines.items;
  for (const f of ["page_in_chunk", "date", "description", "amount", "kind"]) {
    assert.ok(line.required.includes(f), f);
  }
  assert.deepEqual(line.properties.kind.enum, ["purchase", "payment", "refund", "fee", "interest", "other"]);
});
