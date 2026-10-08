import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  balanceDue,
  canRecordPayment,
  checkPaymentAmount,
  COLLECT_BALANCE_LABEL,
  mergeUpdatedDocument,
  paidToDate,
  percentToAmount,
  prefillBalanceAmount,
  round2,
} from "./payment-form.ts";

const invoice = (total: number, ...paid: number[]) => ({
  type: "invoice",
  total_amount: total,
  payments: paid.map((amount) => ({ amount })),
});

test("paid to date and balance are in cents, and the balance never goes below zero", () => {
  assert.equal(paidToDate(invoice(100, 33.33, 33.33, 33.33).payments), 99.99);
  assert.equal(balanceDue(invoice(100, 33.33, 33.33, 33.33)), 0.01);
  assert.equal(balanceDue(invoice(100)), 100);
  assert.equal(balanceDue(invoice(100, 100)), 0);
  assert.equal(balanceDue(invoice(100, 120)), 0, "an overpaid invoice has no balance, not a negative one");
});

test("Record payment is offered on an invoice that still has a balance", () => {
  assert.equal(canRecordPayment(invoice(113)), true);
  assert.equal(canRecordPayment(invoice(113, 50)), true);
});

test("Record payment is hidden on a fully paid invoice (and an overpaid one)", () => {
  assert.equal(canRecordPayment(invoice(113, 113)), false);
  assert.equal(canRecordPayment(invoice(113, 60, 53)), false);
  assert.equal(canRecordPayment(invoice(113, 120)), false);
});

test("Record payment is hidden on estimates, whatever their amounts", () => {
  assert.equal(canRecordPayment({ type: "estimate", total_amount: 500, payments: [] }), false);
});

test("float noise below half a cent doesn't count as a balance", () => {
  assert.equal(canRecordPayment(invoice(0.1 + 0.2, 0.3)), false);
});

test("Collect remaining balance prefills the whole unpaid balance, in cents", () => {
  assert.equal(prefillBalanceAmount(invoice(113)), 113);
  assert.equal(prefillBalanceAmount(invoice(113, 50.55)), 62.45);
});

test("percent amounts are of the invoice total, rounded to cents", () => {
  assert.equal(percentToAmount(50, 113), 56.5);
  assert.equal(percentToAmount(33.3, 100), 33.3);
  assert.equal(round2(1.005), 1.01);
});

test("amount check: zero or negative is refused with the $ / % wording", () => {
  const base = { amount: 0, percent: 0, total: 100, effectiveBalance: 100 };
  assert.match(checkPaymentAmount({ ...base, mode: "dollar" }).error!, /greater than \$0/);
  assert.match(checkPaymentAmount({ ...base, mode: "percent" }).error!, /greater than 0%/);
  assert.match(checkPaymentAmount({ ...base, mode: "dollar", amount: -5 }).error!, /greater than \$0/);
});

test("amount check: more than the balance is refused and says by how much", () => {
  const r = checkPaymentAmount({ mode: "dollar", amount: 120, percent: 0, total: 100, effectiveBalance: 100 });
  assert.match(r.error!, /exceed the invoice total by \$20\.00/);
});

test("amount check: exactly the balance passes, and % mode uses the percent of the total", () => {
  assert.deepEqual(checkPaymentAmount({ mode: "dollar", amount: 100, percent: 0, total: 100, effectiveBalance: 100 }), {
    amount: 100,
    error: null,
  });
  assert.deepEqual(checkPaymentAmount({ mode: "percent", amount: 0, percent: 25, total: 200, effectiveBalance: 200 }), {
    amount: 50,
    error: null,
  });
});

test("amount check: editing a payment may re-use its own old amount (effective balance)", () => {
  // $100 invoice, $60 already paid; editing that $60 payment up to $100 is fine because its own $60 is
  // added back. Without that add-back the same edit would be refused.
  assert.equal(
    checkPaymentAmount({ mode: "dollar", amount: 100, percent: 0, total: 100, effectiveBalance: 40 + 60 }).error,
    null,
  );
  assert.ok(checkPaymentAmount({ mode: "dollar", amount: 100, percent: 0, total: 100, effectiveBalance: 40 }).error);
});

test("after saving, the preview's paid amount, balance and status come from the merged document", () => {
  const before = {
    id: "d1",
    status: "sent",
    total_amount: 113,
    payments: [] as { amount: number }[],
    items: [{ id: "i1" }],
  };
  // What the payments API returns: the document WITHOUT its items.
  const afterApi = { id: "d1", status: "partial", total_amount: 113, payments: [{ amount: 50 }] };
  const merged = mergeUpdatedDocument(before, afterApi);
  assert.equal(merged.status, "partial");
  assert.equal(paidToDate(merged.payments), 50);
  assert.equal(balanceDue(merged), 63);
  assert.deepEqual(merged.items, [{ id: "i1" }], "line items are kept");
  assert.equal(canRecordPayment({ ...merged, type: "invoice" }), true);

  const paidInFull = mergeUpdatedDocument(merged, { status: "paid", payments: [{ amount: 50 }, { amount: 63 }] });
  assert.equal(paidInFull.status, "paid");
  assert.equal(balanceDue(paidInFull), 0);
  assert.equal(canRecordPayment({ ...paidInFull, type: "invoice" }), false, "the button goes away once it is paid");
});

// ---- Wiring: one form, used in both places ----

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("there is ONE payment form: the detail page and the preview dialog both render PaymentForm", () => {
  const detail = read("../components/invoices/document-detail.tsx");
  const dialog = read("../components/invoices/record-payment-dialog.tsx");
  assert.match(detail, /<PaymentForm/);
  assert.match(dialog, /<PaymentForm/);
  // No second copy of the fields or the save call anywhere else.
  assert.doesNotMatch(detail, /setPaymentAmount|setPaymentDate|bank_account_id:/);
  assert.doesNotMatch(dialog, /setPaymentAmount|fetch\(|NumberInput/);
  const form = read("../components/invoices/payment-form.tsx");
  assert.match(form, /\/api\/documents\/\$\{doc\.id\}\/payments/);
});

test("the form keeps the future-date warning, the local-date default, the balance prefill and refresh", () => {
  const form = read("../components/invoices/payment-form.tsx");
  assert.match(form, /isFuturePaymentDate\(date\)/);
  assert.match(form, /useState\(\(\) => localIsoDate\(\)\)/);
  assert.doesNotMatch(form, /toISOString\(\)\.slice/);
  assert.match(form, /prefillBalanceAmount\(doc\)/);
  assert.match(form, /COLLECT_BALANCE_LABEL/);
  assert.equal(COLLECT_BALANCE_LABEL, "Collect remaining balance");
  assert.match(form, /router\.refresh\(\)/);
  assert.match(form, /Record anyway/);
  // The future-date step is inline, not a second modal (it also runs inside the dialog).
  assert.doesNotMatch(form, /ConfirmDialog/);
});

test("the preview panel offers Record payment only through canRecordPayment, and opens it in place", () => {
  const ws = read("../components/invoices/document-workstation.tsx");
  assert.match(ws, /canRecordPayment\(doc\) && \(/);
  assert.match(ws, /COLLECT_BALANCE_LABEL/);
  assert.match(ws, /<RecordPaymentDialog/);
  // Updates the paid amount / balance / status on screen, from the saved document.
  assert.match(ws, /mergeUpdatedDocument\(d, updated\)/);
  assert.match(ws, /useSyncedState\(documents\)/);
  const dialog = read("../components/invoices/record-payment-dialog.tsx");
  assert.match(dialog, /prefillBalance/);
});
