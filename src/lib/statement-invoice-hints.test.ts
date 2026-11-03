import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  depositCount,
  depositHint,
  depositsBanner,
  unpaidInvoicesFrom,
  type InvoiceRow,
} from "./statement-invoice-hints.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const inv = (over: Partial<InvoiceRow> & { n: number }): InvoiceRow => ({
  id: `i${over.n}`,
  type: "invoice",
  status: "sent",
  document_number: over.n,
  issue_date: "2026-03-01",
  total_amount: 100,
  client: { name: `Client ${over.n}` },
  payments: [],
  ...over,
});

const deposit = (amount: number, txn_date = "2026-03-10", kind = "payment") => ({ kind, amount: -amount, txn_date });

test("single match: one unpaid invoice with exactly this balance due, issued on or before the deposit", () => {
  const unpaid = unpaidInvoicesFrom([inv({ n: 1001, total_amount: 615.57 }), inv({ n: 1002, total_amount: 300 })]);
  const hint = depositHint(deposit(615.57), "bank", unpaid);
  assert.equal(hint?.kind, "one");
  assert.deepEqual(hint?.kind === "one" ? [hint.invoice.number, hint.invoice.client_name, hint.invoice.balance_due] : null, ["INV-1001", "Client 1001", 615.57]);
  // issued the same day as the deposit still counts
  assert.equal(depositHint(deposit(615.57, "2026-03-01"), "bank", unpaid)?.kind, "one");
});

test("two matches say how many; no match says nothing", () => {
  const unpaid = unpaidInvoicesFrom([inv({ n: 1, total_amount: 200 }), inv({ n: 2, total_amount: 200 }), inv({ n: 3, total_amount: 50 })]);
  assert.deepEqual(depositHint(deposit(200), "bank", unpaid), { kind: "many", count: 2 });
  assert.equal(depositHint(deposit(75), "bank", unpaid), null);
  assert.equal(depositHint(deposit(200.01), "bank", unpaid), null, "to the cent");
});

test("a partly paid invoice matches on its balance due, not its total", () => {
  const unpaid = unpaidInvoicesFrom([inv({ n: 7, status: "partial", total_amount: 1000, payments: [{ amount: 400 }] })]);
  assert.equal(unpaid[0].balance_due, 600);
  assert.equal(depositHint(deposit(600), "bank", unpaid)?.kind, "one");
  assert.equal(depositHint(deposit(1000), "bank", unpaid), null, "the total no longer matches");
});

test("an invoice dated after the deposit is not offered", () => {
  const unpaid = unpaidInvoicesFrom([inv({ n: 9, total_amount: 80, issue_date: "2026-03-11" })]);
  assert.equal(depositHint(deposit(80, "2026-03-10"), "bank", unpaid), null);
  assert.equal(depositHint(deposit(80, "2026-03-11"), "bank", unpaid)?.kind, "one");
});

test("draft, paid, fully covered, estimate and demo-client invoices are ignored (there is no voided status)", () => {
  const unpaid = unpaidInvoicesFrom([
    inv({ n: 1, status: "draft", total_amount: 50 }),
    inv({ n: 2, status: "paid", total_amount: 50 }),
    inv({ n: 3, status: "sent", total_amount: 50, payments: [{ amount: 50 }] }),
    inv({ n: 4, type: "estimate", total_amount: 50 }),
    inv({ n: 5, total_amount: 50, client: { name: "Demo", is_sample: true } }),
    inv({ n: 6, total_amount: 50, client: null }),
  ]);
  assert.deepEqual(unpaid.map((i) => [i.number, i.client_name]), [["INV-6", "No client"]]);
});

test("banner: counts deposits and unpaid invoices, singular and plural; nothing when M is 0 or there are no deposits", () => {
  const unpaid = unpaidInvoicesFrom([inv({ n: 1 }), inv({ n: 2 })]);
  const one = unpaidInvoicesFrom([inv({ n: 1 })]);
  const lines = [deposit(10), deposit(20), { kind: "purchase", amount: 5 }];
  assert.equal(depositsBanner(lines, "bank", unpaid), "This statement has 2 deposits and you have 2 unpaid invoices. Check whether any were paid.");
  assert.equal(depositsBanner([deposit(10)], "bank", one), "This statement has 1 deposit and you have 1 unpaid invoice. Check whether any were paid.");
  assert.equal(depositsBanner(lines, "bank", []), null, "M = 0");
  assert.equal(depositsBanner([{ kind: "purchase", amount: 5 }], "bank", unpaid), null, "no deposits");
});

test("a credit card statement gets no banner and no hint", () => {
  const unpaid = unpaidInvoicesFrom([inv({ n: 1, total_amount: 40 })]);
  assert.equal(depositsBanner([deposit(40)], "card", unpaid), null);
  assert.equal(depositHint(deposit(40), "card", unpaid), null);
  assert.equal(depositCount([deposit(40)], "card"), 0);
});

test("only genuine deposits are hinted: not a line moved to another kind, not transfers or loan principal (money out)", () => {
  const unpaid = unpaidInvoicesFrom([inv({ n: 1, total_amount: 40 })]);
  assert.equal(depositHint(deposit(40, "2026-03-10", "purchase"), "bank", unpaid), null, "pencilled to purchase");
  assert.equal(depositHint(deposit(40, "2026-03-10", "refund"), "bank", unpaid), null);
  assert.equal(depositHint({ kind: "payment", amount: 40, txn_date: "2026-03-10" }, "bank", unpaid), null, "payment-kind money OUT");
  assert.equal(depositCount([deposit(40), { kind: "payment", amount: 40 }, deposit(5, "2026-03-10", "other")], "bank"), 1);
});

test("the data is read once, past the 1000-row cap, and only for a bank statement with deposits; nothing is written", () => {
  const server = read("./statement-invoice-hints-server.ts");
  assert.match(server, /selectAll</);
  assert.doesNotMatch(server, /\.(insert|update|delete|upsert|rpc)\(/);
  assert.doesNotMatch(read("./statement-invoice-hints.ts"), /balance_due\s*=\s*.*total_amount\s*-/, "no second balance calculation");
  assert.match(read("./statement-invoice-hints.ts"), /import \{ balanceDue \} from "\.\/payment-form\.ts"/);
  assert.match(read("./statement-review-data.ts"), /depositCount\(allLines, accountType\) > 0 \? await loadUnpaidInvoices/);
  assert.match(read("../app/(app)/dashboard/expenses/statements/[id]/page.tsx"), /depositCount\(detail\.lines, detail\.account_type\) > 0/);
});

test("the Record payment button is a Link with nativeButton={false} and goes to the invoice page", () => {
  const ui = read("../components/dashboard/statement-invoice-hint.tsx");
  assert.match(ui, /nativeButton=\{false\} render=\{<Link href=\{invoiceDetailHref\(invoice\.id\)\} \/>\}/);
  assert.match(ui, /Matches unpaid invoice \{invoice\.number\}, \{invoice\.client_name\}/);
});
