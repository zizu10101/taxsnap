import assert from "node:assert/strict";
import test from "node:test";
import { buildStatementPrompt, STATEMENT_SCHEMA } from "./statement-prompt.ts";

const input = {
  today: "2026-10-05",
  pageCount: 3,
  periodStart: "2026-08-15",
  periodEnd: "2026-09-14",
  categories: ["Supplies", "Bank charges"],
  bankChargesCategory: "Bank charges" as string | null,
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

test("the prompt names the owner's bank-charges category by its CURRENT name", () => {
  const p = buildStatementPrompt({ ...input, categories: ["Supplies", "Bank fees"], bankChargesCategory: "Bank fees" });
  assert.ok(p.includes('Use "Bank fees" for interest and bank/card fees.'));
  assert.ok(!p.includes('Use "Bank charges"'), "the old name must not survive a rename");
});

test("with the bank-charges category removed, the prompt doesn't point the model at it", () => {
  const p = buildStatementPrompt({ ...input, categories: ["Supplies"], bankChargesCategory: null });
  assert.ok(p.includes("Use null for interest and bank/card fees"));
  assert.ok(!p.includes("Bank charges"));
});

test("a category name with quotes can't break out of the prompt's quoting", () => {
  const p = buildStatementPrompt({ ...input, bankChargesCategory: 'Fees "and" more' });
  assert.ok(p.includes('Use "Fees \\"and\\" more" for interest'));
});

test("the schema requires the fields sanitizeChunk needs", () => {
  const line = STATEMENT_SCHEMA.properties.lines.items;
  for (const f of ["page_in_chunk", "date", "description", "amount", "kind"]) {
    assert.ok(line.required.includes(f), f);
  }
  assert.deepEqual(line.properties.kind.enum, ["purchase", "payment", "refund", "fee", "interest", "other"]);
});
