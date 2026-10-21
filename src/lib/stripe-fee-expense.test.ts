import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEE_READ_ATTEMPTS, handleConnectEvent, processChargeUpdated, processCheckoutCompleted, type CheckoutDeps, type ConnectEventDeps } from "./online-payments.ts";
import { processChargeRefunded, RetryLater, syncDispute, type DisputeLike } from "./online-refunds.ts";
import { fetchPaymentFee } from "./stripe-fee.ts";
import { feeExpenseNote, recordStripeFeeExpense } from "./stripe-fee-expense.ts";
import { computeExpenseSummary } from "./expense-summary.ts";
import { receiptsToCsv, receiptsToQuickBooksCsv } from "./csv.ts";
import type { Receipt } from "./database.types.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ------------------------------------------------------------------ an in-memory database
// Mirrors what the app relies on: the table filters, the unique indexes of 0069/0071, and
// record_stripe_fee_expense() exactly as the SQL function does it (lock, check outcome, insert, store outcome).

type Row = Record<string, unknown>;

interface Db {
  documents: Row[];
  payments: Row[];
  profiles: Row[];
  receipts: Row[];
  expense_categories: Row[];
  stripe_disputes: Row[];
  stripe_overpayments: Row[];
}

let nextId = 1;

function makeDb(over: { feeSwitch?: boolean; categories?: Row[] } = {}): Db {
  return {
    documents: [
      { id: "doc1", user_id: "u1", type: "invoice", status: "sent", total_amount: 1130, document_number: 1003, view_token: "tok", client: { name: "Ana", email: "ana@example.com" } },
    ],
    payments: [],
    profiles: [
      { id: "u1", stripe_connect_account_id: "acct_1", business_name: "Rivera", subscription_status: "free", record_stripe_fee_expenses: over.feeSwitch ?? true },
    ],
    receipts: [],
    expense_categories: over.categories ?? [],
    stripe_disputes: [],
    stripe_overpayments: [],
  };
}

function fakeAdmin(db: Db) {
  const table = (name: keyof Db) => {
    const rows = db[name];
    const query = (embed?: (r: Row) => Row) => {
      const filters: ((r: Row) => boolean)[] = [];
      const matching = () => rows.filter((r) => filters.every((f) => f(r))).map((r) => (embed ? embed(r) : r));
      const q = {
        eq(col: string, value: unknown) {
          filters.push((r) => r[col] === value);
          return q;
        },
        is(col: string, value: unknown) {
          filters.push((r) => (r[col] ?? null) === value);
          return q;
        },
        maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: matching(), error: null }),
      };
      return q;
    };
    return {
      select: () =>
        name === "documents"
          ? query((d) => ({ ...d, payments: db.payments.filter((p) => p.document_id === d.id) }))
          : query(),
      insert: async (row: Row) => {
        if (name === "payments" && row.source === "stripe" && rows.some((r) => r.source === "stripe" && r.stripe_payment_intent_id === row.stripe_payment_intent_id)) {
          return { error: { code: "23505", message: "dup" } };
        }
        if (name === "stripe_disputes" && rows.some((r) => r.id === row.id)) return { error: { code: "23505", message: "dup" } };
        if (name === "stripe_overpayments" && rows.some((r) => r.payment_intent_id === row.payment_intent_id)) return { error: { code: "23505", message: "dup" } };
        if (name === "expense_categories" && rows.some((r) => String(r.name).toLowerCase() === String(row.name).toLowerCase() && r.user_id === row.user_id)) {
          return { error: { code: "23505", message: "dup" } };
        }
        rows.push({ id: row.id ?? `row${nextId++}`, is_active: true, ...row });
        return { error: null };
      },
      update: (patch: Row) => {
        const filters: ((r: Row) => boolean)[] = [];
        const run = () => {
          for (const r of rows.filter((x) => filters.every((f) => f(x)))) Object.assign(r, patch);
          return { error: null };
        };
        const q = {
          eq(col: string, value: unknown) {
            filters.push((r) => r[col] === value);
            return q;
          },
          is(col: string, value: unknown) {
            filters.push((r) => (r[col] ?? null) === value);
            return q;
          },
          then: (resolve: (v: { error: null }) => unknown) => resolve(run()),
        };
        return q;
      },
    };
  };
  return {
    from: (name: keyof Db) => table(name),
    // record_stripe_fee_expense() from migration 0071, line for line.
    rpc: async (fn: string, a: Record<string, unknown>) => {
      assert.equal(fn, "record_stripe_fee_expense");
      assert.ok((a.p_payment_id == null) !== (a.p_dispute_id == null), "exactly one of payment / dispute");
      assert.ok((a.p_amount as number) > 0);
      const owner = a.p_payment_id != null ? db.payments.find((p) => p.id === a.p_payment_id) : db.stripe_disputes.find((s) => s.id === a.p_dispute_id);
      const doc = owner && db.documents.find((d) => d.id === owner.document_id);
      if (!owner || !doc || doc.user_id !== a.p_user_id) return { data: null, error: { message: "payment or dispute not found for this user" } };
      if (owner.fee_expense_outcome != null) return { data: null, error: null };
      const link = a.p_payment_id != null ? "stripe_payment_id" : "stripe_dispute_id";
      if (db.receipts.some((r) => r[link] === (a.p_payment_id ?? a.p_dispute_id))) return { data: null, error: { message: "unique violation" } };
      const id = `rcpt${nextId++}`;
      db.receipts.push({
        id,
        user_id: a.p_user_id,
        merchant_name: a.p_merchant,
        transaction_date: a.p_date,
        total_amount: a.p_amount,
        tax_amount: 0,
        tax_category: a.p_category,
        items: a.p_items,
        origin: "stripe",
        stripe_payment_id: a.p_payment_id,
        stripe_dispute_id: a.p_dispute_id,
        from_statement: false,
        no_receipt: false,
        tax_rate: null,
        itc_pct: null,
        deductible_pct: null,
        tax_source: null,
      });
      owner.fee_expense_outcome = "recorded";
      return { data: id, error: null };
    },
  } as never;
}

// ------------------------------------------------------------------ checkout / dispute drivers

const session = {
  object: "checkout.session",
  id: "cs_1",
  mode: "payment",
  payment_status: "paid",
  currency: "cad",
  amount_total: 113000,
  payment_intent: "pi_1",
  metadata: { document_id: "doc1" },
};

function checkoutDeps(db: Db, over: Partial<CheckoutDeps> = {}): CheckoutDeps {
  const admin = fakeAdmin(db);
  return {
    now: () => new Date("2026-10-20T15:00:00Z"),
    fetchFee: async () => ({ fee: 33.07, net: 1096.93, chargeId: "ch_1" }),
    sleep: async () => {},
    sendReceipt: async () => true,
    findExcessRefund: async () => null,
    refundExcess: async () => ({ id: "re_x" }),
    notifyOwner: async () => true,
    recordFeeExpense: (input) => recordStripeFeeExpense(admin, input),
    ...over,
  };
}

const pay = (db: Db, over: Partial<CheckoutDeps> = {}) =>
  processCheckoutCompleted(fakeAdmin(db), "acct_1", session, checkoutDeps(db, over));

const charge = { id: "ch_1", currency: "cad", payment_intent: "pi_1", metadata: { document_id: "doc1" } };
const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function disputeObj(status: string, fees: number[], over: Partial<DisputeLike> = {}): DisputeLike {
  return {
    id: "dp_1",
    charge: "ch_1",
    payment_intent: "pi_1",
    amount: 113000,
    currency: "cad",
    status,
    created: at("2026-10-18T10:00:00Z"),
    balance_transactions: fees.map((fee) => ({ fee })),
    ...over,
  };
}

function runDispute(db: Db, d: DisputeLike, opts: { notifyOnOpen?: boolean; eventCreated?: number } = {}) {
  const admin = fakeAdmin(db);
  return syncDispute(
    admin,
    "acct_1",
    { id: d.id, object: "dispute" },
    { livemode: false, notifyOnOpen: opts.notifyOnOpen ?? true, eventCreated: opts.eventCreated },
    {
      now: () => new Date("2026-10-20T15:00:00Z"),
      retrieveCharge: async () => charge,
      retrieveDispute: async () => d,
      notifyOwner: async () => true,
      recordFeeExpense: (input) => recordStripeFeeExpense(admin, input),
    },
  );
}

const feeExpenses = (db: Db) => db.receipts.filter((r) => r.origin === "stripe");

// ------------------------------------------------------------------ the payment fee

test("a recorded payment creates ONE fee expense: Stripe, bank charges, payment date, fee amount, zero tax, labelled automatic", async () => {
  const db = makeDb();
  await pay(db);
  assert.equal(feeExpenses(db).length, 1);
  const e = feeExpenses(db)[0];
  assert.equal(e.merchant_name, "Stripe");
  assert.equal(e.tax_category, "Bank charges");
  assert.equal(e.transaction_date, "2026-10-20", "the payment's own date");
  assert.equal(e.total_amount, 33.07);
  assert.equal(e.tax_amount, 0, "a Stripe fee carries no HST");
  assert.equal(e.tax_rate, null, "no tax code either");
  assert.equal(e.origin, "stripe");
  assert.equal(e.stripe_payment_id, db.payments[0].id);
  assert.deepEqual(e.items, [{ name: "Stripe fee on INV-1003 (recorded automatically)", amount: 33.07 }]);
  assert.equal(db.payments[0].fee_expense_outcome, "recorded");
  // The bank charges category was created, keyed, the way statement import does it.
  assert.deepEqual(
    db.expense_categories.map((c) => [c.name, c.system_key]),
    [["Bank charges", "bank_charges"]],
  );
});

test("a replayed webhook never creates a second fee expense", async () => {
  const db = makeDb();
  await pay(db);
  assert.deepEqual(await pay(db), { status: "duplicate" });
  await pay(db);
  assert.equal(feeExpenses(db).length, 1);
  assert.equal(db.payments.length, 1);
});

test("the user deletes the automatic expense, then Stripe retries: it is NOT recreated", async () => {
  const db = makeDb();
  await pay(db);
  db.receipts.length = 0; // the owner deleted it (DELETE /api/receipts/[id])
  await pay(db);
  await pay(db);
  assert.equal(feeExpenses(db).length, 0);
  assert.equal(db.payments[0].fee_expense_outcome, "recorded", "remembered on the payment row");
});

test("a first delivery that stopped before the expense was created is finished by the retry", async () => {
  const db = makeDb();
  let failures = 1;
  const flaky = {
    recordFeeExpense: async (input: Parameters<CheckoutDeps["recordFeeExpense"]>[0]) => {
      if (failures-- > 0) throw new Error("db down");
      return recordStripeFeeExpense(fakeAdmin(db), input);
    },
  };
  await assert.rejects(pay(db, flaky), /db down/);
  assert.equal(db.payments.length, 1, "the payment itself was recorded");
  assert.equal(feeExpenses(db).length, 0);
  assert.deepEqual(await pay(db, flaky), { status: "duplicate" });
  assert.equal(feeExpenses(db).length, 1);
});

test("a fee that could not be read at payment time is read again on the retry", async () => {
  const db = makeDb();
  await pay(db, { fetchFee: async () => null });
  assert.equal(feeExpenses(db).length, 0);
  assert.equal(db.payments[0].stripe_fee ?? null, null);
  await pay(db); // fetchFee works now
  assert.equal(db.payments[0].stripe_fee, 33.07);
  assert.equal(feeExpenses(db).length, 1);
  assert.equal(feeExpenses(db)[0].total_amount, 33.07);
});

test("switch OFF: nothing is created, and turning it on later does not pull in the earlier payment", async () => {
  const db = makeDb({ feeSwitch: false });
  await pay(db);
  assert.equal(feeExpenses(db).length, 0);
  assert.equal(db.payments[0].fee_expense_outcome, "off");
  db.profiles[0].record_stripe_fee_expenses = true;
  await pay(db); // a retry of the same event
  assert.equal(feeExpenses(db).length, 0, "changing the switch never alters or adds expenses retroactively");
});

test("switch ON again: the NEXT payment's fee is recorded, the earlier one stays unrecorded, nothing existing changes", async () => {
  const db = makeDb({ feeSwitch: false });
  const half = (pi: string) => ({ ...session, id: `cs_${pi}`, payment_intent: pi, amount_total: 56500 });
  await processCheckoutCompleted(fakeAdmin(db), "acct_1", half("pi_1"), checkoutDeps(db));
  assert.equal(feeExpenses(db).length, 0);

  db.profiles[0].record_stripe_fee_expenses = true;
  await processCheckoutCompleted(fakeAdmin(db), "acct_1", half("pi_2"), checkoutDeps(db));
  assert.equal(feeExpenses(db).length, 1);
  const second = db.payments.find((p) => p.stripe_payment_intent_id === "pi_2")!;
  assert.equal(feeExpenses(db)[0].stripe_payment_id, second.id);
  assert.equal(db.payments.find((p) => p.stripe_payment_intent_id === "pi_1")!.fee_expense_outcome, "off");

  const kept = JSON.stringify(feeExpenses(db));
  db.profiles[0].record_stripe_fee_expenses = false;
  await processCheckoutCompleted(fakeAdmin(db), "acct_1", half("pi_2"), checkoutDeps(db)); // a replay while off
  assert.equal(JSON.stringify(feeExpenses(db)), kept, "turning it off changes nothing that exists");
});

test("no fee on the payment (null or 0) creates nothing", async () => {
  const db = makeDb();
  await pay(db, { fetchFee: async () => null });
  assert.equal(feeExpenses(db).length, 0);
  const res = await recordStripeFeeExpense(fakeAdmin(db), { userId: "u1", source: { kind: "payment", id: "x" }, fee: 0, date: "2026-10-20", documentNumber: 1 });
  assert.deepEqual(res, { status: "no_fee" });
});

test("an owner who removed the bank charges category gets 'Other', and it is not brought back", async () => {
  const db = makeDb({ categories: [{ id: "c1", user_id: "u1", name: "Bank fees", is_active: false, system_key: "bank_charges" }] });
  await pay(db);
  assert.equal(feeExpenses(db)[0].tax_category, "Other");
  assert.equal(db.expense_categories.length, 1);
  assert.equal(db.expense_categories[0].is_active, false);
});

test("an owner who renamed the category keeps getting it", async () => {
  const db = makeDb({ categories: [{ id: "c1", user_id: "u1", name: "Bank fees", is_active: true, system_key: "bank_charges" }] });
  await pay(db);
  assert.equal(feeExpenses(db)[0].tax_category, "Bank fees");
  assert.equal(db.expense_categories.length, 1, "no second 'Bank charges'");
});

test("a payment that was only an excess (refunded, never recorded) creates no fee expense", async () => {
  const db = makeDb();
  db.payments.push({ id: "m1", document_id: "doc1", amount: 1130, source: "manual", stripe_payment_intent_id: null, paid_date: "2026-10-01" });
  const res = await pay(db);
  assert.equal(res.status, "skipped");
  assert.equal(feeExpenses(db).length, 0);
});

// ------------------------------------------------------------------ the dispute fee

test("a dispute creates a second expense from the STORED fee, dated when it was received", async () => {
  const db = makeDb();
  await pay(db);
  await runDispute(db, disputeObj("needs_response", [1500]));
  const fees = feeExpenses(db);
  assert.equal(fees.length, 2);
  const d = fees.find((r) => r.stripe_dispute_id === "dp_1")!;
  assert.equal(d.merchant_name, "Stripe");
  assert.equal(d.total_amount, 15, "Stripe's figure from balance_transactions, not the STRIPE_FEES constant");
  assert.equal(d.tax_amount, 0);
  assert.equal(d.tax_category, "Bank charges");
  assert.equal(d.transaction_date, "2026-10-18", "dispute.created, not the day the event was processed");
  assert.deepEqual(d.items, [{ name: "Stripe dispute fee on INV-1003 (recorded automatically)", amount: 15 }]);
  assert.equal(db.stripe_disputes[0].fee_expense_outcome, "recorded");
});

test("the dispute amount follows what Stripe charged: a different fee is a different expense", async () => {
  const db = makeDb();
  await pay(db);
  await runDispute(db, disputeObj("needs_response", [2000]));
  assert.equal(feeExpenses(db).find((r) => r.stripe_dispute_id === "dp_1")!.total_amount, 20);
});

test("replaying dispute.created / closing / deleting the expense never creates it twice", async () => {
  const db = makeDb();
  await pay(db);
  await runDispute(db, disputeObj("needs_response", [1500]));
  await runDispute(db, disputeObj("needs_response", [1500]));
  assert.equal(feeExpenses(db).filter((r) => r.stripe_dispute_id).length, 1);

  db.receipts = db.receipts.filter((r) => !r.stripe_dispute_id); // the owner deletes it
  await runDispute(db, disputeObj("needs_response", [1500]));
  assert.equal(feeExpenses(db).filter((r) => r.stripe_dispute_id).length, 0, "not recreated");
});

test("a dispute won: the fee is reversed by Stripe, nothing new is created and the first expense is left alone", async () => {
  const db = makeDb();
  await pay(db);
  await runDispute(db, disputeObj("needs_response", [1500]));
  await runDispute(db, disputeObj("won", [1500, -1500]), { notifyOnOpen: false });
  assert.equal(feeExpenses(db).filter((r) => r.stripe_dispute_id).length, 1);
  assert.equal(db.stripe_disputes[0].fee, null, "the stored fee is the NET of Stripe's balance transactions, so it reads null after a win");
});

test("a dispute first seen already won (net fee 0) records no fee", async () => {
  const db = makeDb();
  await pay(db);
  await runDispute(db, disputeObj("won", [1500, -1500]), { notifyOnOpen: false });
  assert.equal(feeExpenses(db).filter((r) => r.stripe_dispute_id).length, 0);
});

test("a lost dispute creates the fee expense once (and the payment reversal keeps working)", async () => {
  const db = makeDb();
  await pay(db);
  await runDispute(db, disputeObj("lost", [1500]), { notifyOnOpen: false, eventCreated: at("2026-10-19T12:00:00Z") });
  assert.equal(feeExpenses(db).filter((r) => r.stripe_dispute_id).length, 1);
  assert.equal(db.payments.filter((p) => p.source === "stripe_dispute").length, 1);
});

test("dispute fee with the switch off: nothing created", async () => {
  const db = makeDb({ feeSwitch: false });
  await pay(db);
  await runDispute(db, disputeObj("needs_response", [1500]));
  assert.equal(feeExpenses(db).length, 0);
  assert.equal(db.stripe_disputes[0].fee_expense_outcome, "off");
});

// ------------------------------------------------------------------ refunds

test("a refund creates no expense and no reversal of the fee expense", async () => {
  const db = makeDb();
  await pay(db);
  const before = JSON.stringify(db.receipts);
  await processChargeRefunded(
    fakeAdmin(db),
    "acct_1",
    { id: "ch_1", object: "charge" },
    {
      now: () => new Date("2026-10-21T15:00:00Z"),
      retrieveCharge: async () => charge,
      listRefunds: async () => [{ id: "re_1", amount: 50000, status: "succeeded", created: at("2026-10-21T10:00:00Z"), currency: "cad", metadata: {} }],
    },
  );
  assert.equal(db.payments.filter((p) => p.source === "stripe_refund").length, 1, "the payment refund is mirrored as before");
  assert.equal(JSON.stringify(db.receipts), before, "...but no expense was added, changed or reversed");
  assert.doesNotMatch(read("./online-refunds.ts").slice(read("./online-refunds.ts").indexOf("export async function processChargeRefunded"), read("./online-refunds.ts").indexOf("// ---", read("./online-refunds.ts").indexOf("export async function processChargeRefunded"))), /recordFeeExpense/);
});

// ------------------------------------------------------------------ caps, tax and reports

test("the fee expense never uses a scan: the Free cap skips origin 'stripe' rows, and no AI call is involved", () => {
  const route = read("../app/api/parse-receipt/route.ts");
  const count = route.slice(route.indexOf('.from("receipts")'), route.indexOf("FREE_SCAN_LIMIT)", route.indexOf('.from("receipts")')));
  assert.match(count, /\.is\("origin", null\)/);
  assert.match(count, /gte\("created_at"/);
  const mod = read("./stripe-fee-expense.ts");
  assert.doesNotMatch(mod, /gemini|parseReceiptImage|genai/i);
  // No other cap counts receipts: the only receipts-based limit is the scan allowance.
  assert.doesNotMatch(read("./plan-limits.ts"), /expensesPerMonth|receiptsTotal/);
});

test("tax: the expense adds nothing to Est. HST reclaimable, and counts in total and deductible spend like any other", async () => {
  const db = makeDb();
  await pay(db);
  const rows = feeExpenses(db) as unknown as Parameters<typeof computeExpenseSummary>[0];
  const alone = computeExpenseSummary(rows);
  assert.equal(alone.totalExpenses, 33.07);
  assert.equal(alone.deductibleSpend, 33.07);
  assert.equal(alone.estHstReclaimable, 0);
  assert.equal(alone.estHstCalculated, 0);
  assert.equal(alone.calculatedCount, 0, "not a statement expense, so no 'calculated' split");

  const scanned = { total_amount: 113, tax_amount: 13, tax_category: "Supplies", from_statement: false, no_receipt: false } as never;
  const both = computeExpenseSummary([...rows, scanned]);
  assert.equal(both.totalExpenses, 146.07);
  assert.equal(both.estHstReclaimable, 13, "only the scanned receipt's HST");
});

test("exports: the CSV, the QuickBooks CSV (and so the accountant bundle) carry the row, tax 0.00, with the automatic note", async () => {
  const db = makeDb();
  await pay(db);
  const receipts = feeExpenses(db) as unknown as Receipt[];
  const csv = receiptsToCsv(receipts).split("\n");
  assert.match(csv[1], /^2026-10-20,Stripe,Bank charges,33\.07,0\.00,33\.07,Stripe fee on INV-1003 \(recorded automatically\) \(\$33\.07\),/);
  assert.equal(csv[1].split(",").at(-1), "Confirmed by receipt");
  const qb = receiptsToQuickBooksCsv(receipts).split("\n");
  assert.equal(qb[1], "10/20/2026,Stripe - Bank charges,33.07,");
  // The accountant bundle builds from these same two functions.
  assert.match(read("./accountant-export.ts"), /receiptsToCsv\(/);
  assert.match(read("./accountant-export.ts"), /receiptsToQuickBooksCsv\(/);
});

// ------------------------------------------------------------------ wiring and wording

test("the webhook hands the real recorder to the handlers, and the SQL function is service-role only", () => {
  assert.match(read("../app/api/stripe/connect-webhook/route.ts"), /recordFeeExpense:[^\n]*recordStripeFeeExpense\(admin, input\)/);
  const sql = read("../../supabase/migrations/0071_stripe_fee_expenses.sql");
  assert.match(sql, /revoke all on function public\.record_stripe_fee_expense[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.record_stripe_fee_expense[\s\S]*to service_role/);
  assert.match(sql, /create unique index if not exists receipts_stripe_payment_uniq/);
  assert.match(sql, /create unique index if not exists receipts_stripe_dispute_uniq/);
  assert.match(sql, /record_stripe_fee_expenses boolean not null default true/);
});

test("the rollback undoes every object 0071 creates", () => {
  const down = read("../../supabase/rollbacks/0071_stripe_fee_expenses_rollback.sql");
  for (const t of [
    /drop function if exists public\.record_stripe_fee_expense/,
    /drop trigger if exists receipts_stripe_origin_guard/,
    /drop index if exists public\.receipts_stripe_payment_uniq/,
    /drop index if exists public\.receipts_stripe_dispute_uniq/,
    /drop column if exists origin/,
    /drop column if exists record_stripe_fee_expenses/,
  ]) {
    assert.match(down, t);
  }
});

test("the switch: exact wording in the Online payments card, saved through its own route, off never edits expenses", () => {
  const card = read("../components/settings/online-payments-card.tsx");
  assert.match(card, /Record Stripe fees as expenses automatically\. Turn this off if you already log them from your bank\./);
  assert.match(card, /\/api\/profile\/stripe-fee-expenses/);
  const route = read("../app/api/profile/stripe-fee-expenses/route.ts");
  assert.match(route, /record_stripe_fee_expenses: enabled/);
  assert.doesNotMatch(route, /from\("receipts"\)/, "the switch never touches an existing expense");
});

test("the fee wording and Terms section 11", () => {
  const terms = read("./online-payments-terms.ts");
  assert.match(terms, /Fees are recorded as an expense without tax\. Check your Stripe statement if tax is shown\./);
  assert.match(terms, /Stripe's processing fee is recorded as an expense with no tax and is not part of your HST totals\./);
  const page = read("../app/terms/page.tsx");
  assert.match(page, /FEE_EXPENSE_HST_SENTENCE/);
  assert.doesNotMatch(page, /shown for information only/);
  assert.equal(read("./legal-versions.ts").match(/TERMS_VERSION = "([^"]+)"/)?.[1], "2026-10-draft-3");
  assert.match(read("../../docs/legal-drafts/lawyer-brief.md"), /Terms section 11 changed in draft 3/);
});

test("the notes are plain text a person can read and edit", () => {
  assert.equal(feeExpenseNote("payment", 1003), "Stripe fee on INV-1003 (recorded automatically)");
  assert.equal(feeExpenseNote("dispute", 1003), "Stripe dispute fee on INV-1003 (recorded automatically)");
});

// ------------------------------------------------------------------ the fee arrives late (balance_transaction is null at first)

const fee = { fee: 33.07, net: 1096.93, chargeId: "ch_1" };

test("fetchPaymentFee reads the PaymentIntent on the CONNECTED account with the balance transaction expanded; cents become dollars", async () => {
  const calls: unknown[][] = [];
  const stripe = {
    paymentIntents: {
      retrieve: async (...args: unknown[]) => {
        calls.push(args);
        return { latest_charge: { id: "ch_9", balance_transaction: { fee: 3307, net: 109693 } } };
      },
    },
  };
  const got = await fetchPaymentFee(stripe as never, "pi_9", "acct_1US7IiBDHa94jUe9");
  assert.deepEqual(got, { fee: 33.07, net: 1096.93, chargeId: "ch_9" });
  assert.deepEqual(calls, [["pi_9", { expand: ["latest_charge.balance_transaction"] }, { stripeAccount: "acct_1US7IiBDHa94jUe9" }]]);
});

test("fetchPaymentFee: no balance transaction yet (or an unexpanded charge) is null, not an error; a Stripe error is thrown", async () => {
  const reader = (latest_charge: unknown) => ({ paymentIntents: { retrieve: async () => ({ latest_charge }) } }) as never;
  assert.equal(await fetchPaymentFee(reader({ id: "ch_1", balance_transaction: null }), "pi", "acct"), null);
  assert.equal(await fetchPaymentFee(reader({ id: "ch_1", balance_transaction: "txn_1" }), "pi", "acct"), null);
  assert.equal(await fetchPaymentFee(reader("ch_1"), "pi", "acct"), null);
  assert.equal(await fetchPaymentFee(reader(null), "pi", "acct"), null);
  const failing = {
    paymentIntents: {
      retrieve: async () => {
        throw new Error("resource_missing");
      },
    },
  } as never;
  await assert.rejects(fetchPaymentFee(failing, "pi", "acct"), /resource_missing/);
  assert.match(read("./stripe-fee.ts"), /stripeAccount: accountId/);
  assert.match(read("./stripe-connect.ts"), /export \{ fetchPaymentFee \} from "@\/lib\/stripe-fee"/);
});

test("the fee shows up a few seconds late: the same delivery waits, then records the payment's fee expense", async () => {
  const db = makeDb();
  let reads = 0;
  let sleeps = 0;
  await pay(db, {
    fetchFee: async () => (++reads <= 2 ? null : fee), // null, null, then Stripe has attached it
    sleep: async () => void sleeps++,
  });
  assert.equal(reads, 3);
  assert.equal(sleeps, 2);
  assert.equal(db.payments[0].stripe_fee, 33.07);
  assert.equal(db.payments[0].stripe_net, 1096.93);
  assert.equal(db.payments[0].stripe_charge_id, "ch_1");
  assert.equal(feeExpenses(db).length, 1, "created in the same delivery");
});

test("the payment is saved BEFORE waiting for the fee (a slow fee can never lose the payment)", async () => {
  const db = makeDb();
  await pay(db, {
    fetchFee: async () => {
      assert.equal(db.payments.length, 1, "already recorded when the fee is first read");
      assert.equal(db.documents[0].status, "paid");
      return fee;
    },
  });
});

test("a fee that never appears in time: payment kept, no expense, a bounded number of reads; charge.updated then finishes it", async () => {
  const db = makeDb();
  let reads = 0;
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => void warnings.push(String(m));
  try {
    const res = await pay(db, { fetchFee: async () => (reads++, null) });
    assert.equal(res.status, "recorded");
  } finally {
    console.warn = warn;
  }
  assert.equal(reads, FEE_READ_ATTEMPTS, "bounded");
  assert.equal(feeExpenses(db).length, 0);
  assert.equal(db.payments[0].stripe_fee ?? null, null);
  assert.ok(warnings.some((w) => /\[fee\] not available yet where=checkout\.fee-read/.test(w)));

  // Stripe sends charge.updated when the balance transaction is attached.
  const admin = fakeAdmin(db);
  const deps = checkoutDeps(db);
  const event = { id: "ch_1", object: "charge", payment_intent: "pi_1", metadata: { document_id: "doc1" } };
  assert.deepEqual(await processChargeUpdated(admin, "acct_1", event, deps), { status: "processed", feeStored: true });
  assert.equal(db.payments[0].stripe_fee, 33.07);
  assert.equal(feeExpenses(db).length, 1);
  assert.equal(feeExpenses(db)[0].stripe_payment_id, db.payments[0].id);

  // Replayed, or sent again for any later charge update: still one.
  await processChargeUpdated(admin, "acct_1", event, deps);
  await processChargeUpdated(admin, "acct_1", event, deps);
  assert.equal(feeExpenses(db).length, 1);
});

test("charge.updated after the owner deleted the automatic expense: not recreated", async () => {
  const db = makeDb();
  await pay(db);
  db.receipts.length = 0;
  const event = { id: "ch_1", object: "charge", payment_intent: "pi_1", metadata: {} };
  await processChargeUpdated(fakeAdmin(db), "acct_1", event, checkoutDeps(db));
  assert.equal(feeExpenses(db).length, 0);
});

test("charge.updated with the fee still not attached does nothing and changes nothing", async () => {
  const db = makeDb();
  await pay(db, { fetchFee: async () => null });
  const res = await processChargeUpdated(
    fakeAdmin(db),
    "acct_1",
    { id: "ch_1", object: "charge", payment_intent: "pi_1" },
    checkoutDeps(db, { fetchFee: async () => null }),
  );
  assert.deepEqual(res, { status: "no_fee_yet" });
  assert.equal(feeExpenses(db).length, 0);
});

test("charge.updated: unrelated charges, other accounts and not-yet-recorded payments", async () => {
  const db = makeDb();
  const deps = checkoutDeps(db);
  const admin = fakeAdmin(db);
  assert.deepEqual(await processChargeUpdated(admin, "acct_1", { id: "ch_x", object: "charge", payment_intent: "pi_other" }, deps), {
    status: "ignored",
    reason: "not_a_taxsnap_payment",
  });
  assert.deepEqual(await processChargeUpdated(admin, "acct_1", { id: "ch_x", object: "charge", payment_intent: null }, deps), {
    status: "ignored",
    reason: "no_payment_intent",
  });
  assert.deepEqual(await processChargeUpdated(admin, null, { id: "ch_x", object: "charge", payment_intent: "pi_1" }, deps), {
    status: "ignored",
    reason: "no_connected_account",
  });
  // Ours (carries the document id) but checkout.session.completed has not been processed: Stripe must redeliver.
  await assert.rejects(
    processChargeUpdated(admin, "acct_1", { id: "ch_1", object: "charge", payment_intent: "pi_1", metadata: { document_id: "doc1" } }, deps),
    RetryLater,
  );
  await pay(db, { fetchFee: async () => null });
  assert.deepEqual(await processChargeUpdated(admin, "acct_other", { id: "ch_1", object: "charge", payment_intent: "pi_1" }, deps), {
    status: "ignored",
    reason: "account_mismatch",
  });
  assert.equal(feeExpenses(db).length, 0);
});

test("a replay of the checkout event picks up an existing payment row whose fee is NULL (as the sandbox rows are)", async () => {
  const db = makeDb();
  db.payments.push({
    id: "old-pay",
    document_id: "doc1",
    amount: 1130,
    paid_date: "2026-10-19",
    method: "Card (online)",
    source: "stripe",
    stripe_payment_intent_id: "pi_1",
    stripe_charge_id: null,
    stripe_fee: null,
    stripe_net: null,
  });
  db.documents[0].status = "paid";
  assert.deepEqual(await pay(db), { status: "duplicate" });
  assert.equal(db.payments.length, 1, "no second payment");
  assert.equal(db.payments[0].stripe_fee, 33.07);
  assert.equal(db.payments[0].stripe_net, 1096.93);
  assert.equal(db.payments[0].stripe_charge_id, "ch_1");
  assert.equal(feeExpenses(db).length, 1);
  assert.equal(feeExpenses(db)[0].transaction_date, "2026-10-19", "dated by the payment, not the replay");
  await pay(db);
  assert.equal(feeExpenses(db).length, 1);
});

test("fee-read failures are logged with a where= label, never swallowed", async () => {
  const db = makeDb();
  const lines: string[] = [];
  const error = console.error;
  console.error = (m: string) => void lines.push(String(m));
  try {
    await pay(db, {
      fetchFee: async () => {
        throw Object.assign(new Error("No such payment_intent"), { type: "StripeInvalidRequestError", code: "resource_missing", requestId: "req_1" });
      },
    });
  } finally {
    console.error = error;
  }
  assert.equal(lines.length, FEE_READ_ATTEMPTS);
  assert.match(lines[0], /^\[stripe-error\] where=checkout\.fee-read pi=pi_1 attempt=1\/\d+ type=StripeInvalidRequestError code=resource_missing/);
  assert.equal(db.payments.length, 1, "the payment still stands");
  assert.doesNotMatch(read("./online-payments.ts"), /fetchFee\([^)]*\)\.catch\(\(\) => null\)/, "no silent catch");
});

test("the webhook dispatches charge.updated, and the route no longer wraps fetchFee in its own silent catch", async () => {
  const db = makeDb();
  await pay(db, { fetchFee: async () => null });
  const deps = { ...checkoutDeps(db) } as unknown as ConnectEventDeps;
  const note = await handleConnectEvent(
    fakeAdmin(db),
    { type: "charge.updated", account: "acct_1", data: { object: { id: "ch_1", object: "charge", payment_intent: "pi_1" } } },
    deps,
  );
  assert.equal(note, null);
  assert.equal(feeExpenses(db).length, 1);
  const route = read("../app/api/stripe/connect-webhook/route.ts");
  assert.match(route, /charge\.updated/);
  assert.match(route, /fetchFee: \(paymentIntentId, accountId\) => fetchPaymentFee\(stripe, paymentIntentId, accountId\)/);
});
