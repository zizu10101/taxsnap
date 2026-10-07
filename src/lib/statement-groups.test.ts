import assert from "node:assert/strict";
import test from "node:test";
import { outcomeOf, reconcileLabel, summarizeLines, type SummaryLine } from "./statement-summary.ts";
import {
  cleanExpectation,
  expectationMatches,
  expectationOf,
  planStatementDelete,
  type DeleteLine,
  type DeleteReceipt,
} from "./statement-delete.ts";
import {
  alreadyImportedInfo,
  alreadyImportedMessage,
  capAllowsReimport,
  capNote,
  reimportBringsBack,
} from "./statement-reimport.ts";
import { torontoMonthStart } from "./toronto-month.ts";
import { STATEMENTS_HREF, expenseHref, statementHref } from "./statement-routes.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const line = (over: Partial<SummaryLine> = {}): SummaryLine => ({
  kind: "purchase",
  created_receipt_id: null,
  matched_receipt_id: null,
  released_at: null,
  released_from: null,
  ...over,
});
const made = (n: number) => line({ created_receipt_id: id(n) });
const matchedTo = (n: number) => line({ matched_receipt_id: id(n) });
const deleted = () => line({ released_at: "2026-10-07T10:00:00Z", released_from: "new_expense" });
const matchGone = () => line({ released_at: "2026-10-07T10:00:00Z", released_from: "matched" });
const excluded = () => line();
const payment = () => line({ kind: "payment" });

// ---- outcomes and counts -----------------------------------------------------------------------

test("every line has exactly one outcome; a payment is always a payment", () => {
  assert.equal(outcomeOf(made(1)), "new_expense");
  assert.equal(outcomeOf(matchedTo(1)), "matched");
  assert.equal(outcomeOf(deleted()), "expense_deleted");
  assert.equal(outcomeOf(matchGone()), "match_removed");
  assert.equal(outcomeOf(excluded()), "excluded");
  assert.equal(outcomeOf(payment()), "payment");
  assert.equal(outcomeOf(line({ kind: "payment", released_from: "new_expense", released_at: "x" })), "payment");
});

test("created/matched/skipped keep their TRUE totals after deletes (that is what 0058 is for)", () => {
  const s = summarizeLines([made(1), made(2), deleted(), deleted(), matchedTo(5), matchGone(), excluded(), payment()]);
  assert.equal(s.created, 4, "2 still exist + 2 were deleted");
  assert.equal(s.created_remaining, 2);
  assert.equal(s.matched, 2);
  assert.equal(s.matched_remaining, 1);
  assert.equal(s.skipped, 2, "the excluded line and the payment");
  assert.equal(s.lines, 8);
});

test("free lines: excluded and released count, payments and lines whose expense still exists do not", () => {
  const s = summarizeLines([made(1), matchedTo(2), payment(), payment(), excluded(), excluded(), deleted(), matchGone()]);
  assert.deepEqual(s.free, { excluded: 2, released: 2, total: 4 });
  const none = summarizeLines([made(1), matchedTo(2), payment()]);
  assert.equal(none.free.total, 0);
  assert.equal(summarizeLines([payment(), payment()]).free.total, 0, "payments alone never make a statement re-importable");
});

test("an import with no deletes yet is summarised exactly (no backfill needed)", () => {
  const s = summarizeLines([made(1), made(2), made(3), made(4), excluded()]);
  assert.deepEqual([s.created, s.created_remaining, s.free.total], [4, 4, 1]);
});

// ---- the reconcile label -----------------------------------------------------------------------

test("reconcile: agreement is 'Reconciled'; an accepted difference is NEVER called reconciled", () => {
  assert.equal(reconcileLabel({ reconcile_diff: 0, reconcile_acknowledged: false }).label, "Reconciled");
  const ack = reconcileLabel({ reconcile_diff: -31.67, reconcile_acknowledged: true });
  assert.equal(ack.label, "Difference acknowledged ($31.67)");
  assert.doesNotMatch(ack.label, /reconciled/i);
  assert.equal(ack.tone, "warn");
  assert.equal(reconcileLabel({ reconcile_diff: 12.5, reconcile_acknowledged: false }).label, "Off by $12.50");
  assert.equal(reconcileLabel({ reconcile_diff: null, reconcile_acknowledged: false }).label, "No total to check against");
  // acknowledging nothing doesn't turn a match into a warning
  assert.equal(reconcileLabel({ reconcile_diff: 0, reconcile_acknowledged: true }).label, "Reconciled");
});

// ---- the delete plan -----------------------------------------------------------------------

const rcpt = (n: number, over: Partial<DeleteReceipt> = {}): DeleteReceipt => ({
  id: id(n),
  merchant_name: `Vendor ${n}`,
  transaction_date: "2026-02-08",
  total_amount: 113,
  tax_amount: 13,
  from_statement: true,
  no_receipt: true,
  ...over,
});
const dl = (n: number, over: Partial<DeleteLine> = {}): DeleteLine => ({
  id: `line-${n}`,
  kind: "purchase",
  created_receipt_id: id(n),
  matched_receipt_id: null,
  ...over,
});

test("delete plan: no-receipt expenses are deleted; receipt-attached ones stay; matched receipts are only unlinked", () => {
  const lines: DeleteLine[] = [
    dl(1),
    dl(2), // a receipt was attached
    dl(3, { created_receipt_id: null, matched_receipt_id: id(3) }), // matched to an ordinary receipt
    dl(4, { created_receipt_id: null }), // excluded
    dl(5, { kind: "payment", created_receipt_id: null }),
  ];
  const plan = planStatementDelete(lines, [rcpt(1), rcpt(2, { no_receipt: false }), rcpt(3, { from_statement: false, no_receipt: false })]);
  assert.deepEqual(plan.delete.map((d) => d.receipt.id), [id(1)]);
  assert.deepEqual(plan.keep.map((d) => d.receipt.id), [id(2)]);
  assert.deepEqual(plan.unlink, [{ line_id: "line-3", receipt_id: id(3) }]);
  assert.deepEqual([plan.counts.delete, plan.counts.keep, plan.counts.unlink], [1, 1, 1]);
  // the matched receipt and the kept expense are NEVER in the delete set
  assert.ok(!plan.delete.some((d) => [id(2), id(3)].includes(d.receipt.id)));
});

test("delete plan: totals, tax and job tags are reported for the preview", () => {
  const plan = planStatementDelete(
    [dl(1), dl(2)],
    [rcpt(1, { job_name: "Smith Kitchen" }), rcpt(2, { total_amount: 50, tax_amount: 5.75 })],
  );
  assert.equal(plan.counts.delete_total, 163);
  assert.equal(plan.counts.delete_tax, 18.75);
  assert.equal(plan.counts.delete_on_jobs, 1);
});

test("a partly deleted statement: only what still exists is planned; with nothing left the plan is empty", () => {
  const lines: DeleteLine[] = [dl(1), dl(2, { created_receipt_id: null, released_at: "t", released_from: "new_expense" })];
  assert.equal(planStatementDelete(lines, [rcpt(1)]).counts.delete, 1);
  const empty = planStatementDelete([dl(2, { created_receipt_id: null, released_at: "t", released_from: "new_expense" })], []);
  assert.deepEqual([empty.counts.delete, empty.counts.keep, empty.counts.unlink], [0, 0, 0]);
});

test("a line pointing at an expense we can't see is never acted on", () => {
  assert.equal(planStatementDelete([dl(1)], []).counts.delete, 0);
});

test("stale protection: a receipt attached after the preview changes the plan, so the expectation no longer matches", () => {
  const lines = [dl(1), dl(2)];
  const preview = planStatementDelete(lines, [rcpt(1), rcpt(2)]);
  const expect = expectationOf(preview);
  assert.equal(expectationMatches(preview, expect), true);
  const after = planStatementDelete(lines, [rcpt(1), rcpt(2, { no_receipt: false })]);
  assert.equal(expectationMatches(after, expect), false, "expense 2 now has a receipt: abort, show fresh counts");
  // an expense deleted by hand since also changes it
  assert.equal(expectationMatches(planStatementDelete([dl(1)], [rcpt(1)]), expect), false);
});

test("cleanExpectation accepts exactly three duplicate-free lists of uuids", () => {
  const ok = { delete_ids: [id(1)], unlink_line_ids: [id(2)], keep_ids: [] };
  assert.deepEqual(cleanExpectation(ok), ok);
  assert.equal(cleanExpectation({ ...ok, delete_ids: ["x"] }), null);
  assert.equal(cleanExpectation({ ...ok, keep_ids: [id(3), id(3)] }), null);
  assert.equal(cleanExpectation({ delete_ids: [] }), null);
  assert.equal(cleanExpectation(null), null);
});

// ---- the ALREADY_IMPORTED refusal and re-import ------------------------------------------------

const info = (lines: SummaryLine[], cap = { used: 1, cap: 3 as number | null }) =>
  alreadyImportedInfo(id(9), "2026-10-07T20:22:00Z", lines, cap);

test("message: 'This statement was imported on <date>. N of its M expenses still exist.'", () => {
  assert.equal(
    alreadyImportedMessage(info([made(1), made(2), deleted(), deleted()])),
    "This statement was imported on Oct 7, 2026. 2 of its 4 expenses still exist.",
  );
  assert.match(alreadyImportedMessage(info([deleted(), deleted(), excluded()])), /None of its 2 expenses still exist/);
  assert.match(alreadyImportedMessage(info([made(1), made(2)])), /All 2 of its expenses still exist/);
  assert.match(alreadyImportedMessage(info([made(1)])), /Its 1 expense still exists/);
  assert.match(alreadyImportedMessage(info([deleted()])), /Its 1 expense no longer exists/);
  // a statement whose lines never became expenses (or history lost before 0058)
  assert.match(alreadyImportedMessage(info([excluded(), excluded()])), /None of its lines became expenses/);
});

test("Re-import is offered only when at least one line is free", () => {
  assert.equal(info([made(1), made(2)]).can_reimport, false);
  assert.equal(info([made(1), payment()]).can_reimport, false, "a payment is never free");
  assert.equal(info([made(1), excluded()]).can_reimport, true, "an excluded purchase line is");
  assert.equal(info([deleted()]).can_reimport, true, "a released line is");
  assert.equal(info([matchGone()]).can_reimport, true);
});

test("the dialog states both counts: lines you excluded, and lines whose expense was deleted", () => {
  const free = info([made(1), excluded(), excluded(), deleted(), deleted(), deleted(), matchGone()]).free;
  assert.equal(
    reimportBringsBack(free),
    "Re-importing brings back 2 lines you excluded and 4 lines whose expense was deleted.",
  );
  assert.equal(reimportBringsBack(info([excluded()]).free), "Re-importing brings back 1 line you excluded.");
  assert.equal(reimportBringsBack(info([deleted()]).free), "Re-importing brings back 1 line whose expense was deleted.");
  assert.equal(reimportBringsBack({ excluded: 0, released: 0, total: 0 }), "");
});

test("the cap: a re-import is charged like any import, and blocked at the cap", () => {
  assert.equal(capAllowsReimport({ used: 2, cap: 3 }), true);
  assert.equal(capAllowsReimport({ used: 3, cap: 3 }), false);
  assert.equal(capAllowsReimport({ used: 99, cap: null }), true, "no cap = unlimited");
  assert.match(capNote({ used: 2, cap: 3 }), /uses 1 of your 3 \(2 used so far this month\)/);
  assert.match(capNote({ used: 1, cap: 1 }), /used all 1 of your imports this month/);
  assert.match(capNote({ used: 5, cap: null }), /counts toward your monthly imports/);
});

// ---- the month the cap counts in ---------------------------------------------------------------

test("Toronto's month starts at 05:00 UTC in winter and 04:00 UTC in summer", () => {
  assert.equal(torontoMonthStart(new Date("2026-01-20T12:00:00Z")).toISOString(), "2026-01-01T05:00:00.000Z");
  assert.equal(torontoMonthStart(new Date("2026-07-20T12:00:00Z")).toISOString(), "2026-07-01T04:00:00.000Z");
  assert.equal(torontoMonthStart(new Date("2026-10-07T20:22:00Z")).toISOString(), "2026-10-01T04:00:00.000Z");
  assert.equal(torontoMonthStart(new Date("2026-11-15T12:00:00Z")).toISOString(), "2026-11-01T04:00:00.000Z", "DST ends on the first Sunday of Nov, AFTER midnight on the 1st");
  assert.equal(torontoMonthStart(new Date("2026-12-05T12:00:00Z")).toISOString(), "2026-12-01T05:00:00.000Z");
});

test("a moment just after midnight on the 1st UTC still belongs to the previous Toronto month", () => {
  // 2026-11-01T02:00Z is still Oct 31 at 22:00 in Toronto
  assert.equal(torontoMonthStart(new Date("2026-11-01T02:00:00Z")).toISOString(), "2026-10-01T04:00:00.000Z");
});

test("every link to a statement or an expense goes through statement-routes (one place to move it)", () => {
  assert.equal(STATEMENTS_HREF, "/dashboard/expenses/statements");
  assert.equal(statementHref("abc"), "/dashboard/expenses/statements/abc");
  assert.equal(expenseHref("abc"), "/dashboard/expenses?receipt=abc");
});
