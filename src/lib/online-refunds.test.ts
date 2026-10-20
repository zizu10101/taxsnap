import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleConnectEvent, processCheckoutCompleted, type ConnectEventDeps } from "./online-payments.ts";
import {
  EXCESS_REFUND_FLAG,
  RetryLater,
  disputeStripeUrl,
  excessRefundKey,
  isDisputeOpen,
  isExcessRefund,
  planReversal,
  processChargeRefunded,
  reversalCapacity,
  settleExcess,
  syncDispute,
  type ChargeLike,
  type DisputeLike,
  type OwnerNotice,
  type RefundLike,
} from "./online-refunds.ts";
import { recognizePayments } from "./payment-revenue.ts";
import { statusFromPaid } from "./payments.ts";
import { paymentKind, paymentKindLabel } from "./payment-kind.ts";
import { receiptsToQuickBooksCsv } from "./csv.ts";
import { STRIPE_PAYMENT_LOCKED_MESSAGE, STRIPE_REVERSAL_LOCKED_MESSAGE, stripePaymentLockMessage } from "./stripe-payment-lock.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ------------------------------------------------------------------ an in-memory database

type Row = Record<string, unknown>;

// The unique indexes of 0069 that the code relies on.
const UNIQUE: Record<string, (row: Row, rows: Row[]) => boolean> = {
  payments: (row, rows) =>
    rows.some(
      (r) =>
        (row.stripe_refund_id != null && r.stripe_refund_id === row.stripe_refund_id) ||
        (row.stripe_dispute_id != null && r.stripe_dispute_id === row.stripe_dispute_id) ||
        (row.source === "stripe" && r.source === "stripe" && r.stripe_payment_intent_id === row.stripe_payment_intent_id),
    ),
  stripe_disputes: (row, rows) => rows.some((r) => r.id === row.id),
  stripe_overpayments: (row, rows) => rows.some((r) => r.payment_intent_id === row.payment_intent_id),
};

interface Db {
  payments: Row[];
  documents: Row[];
  profiles: Row[];
  stripe_disputes: Row[];
  stripe_overpayments: Row[];
  stripe_events: Row[];
}

let nextId = 1;

function makeDb(over: Partial<Db> = {}): Db {
  return {
    payments: [],
    documents: [
      {
        id: "doc1",
        user_id: "u1",
        type: "invoice",
        status: "paid",
        total_amount: 1130,
        subtotal: 1000,
        hst_amount: 130,
        document_number: 12,
        view_token: "tok",
        payment_disputed: false,
        client: { name: "Ana Client", email: "ana@example.com" },
      },
    ],
    profiles: [{ id: "u1", stripe_connect_account_id: "acct_1", business_name: "Rivera Painting", subscription_status: "free" }],
    stripe_disputes: [],
    stripe_overpayments: [],
    stripe_events: [],
    ...over,
  };
}

function fakeAdmin(db: Db) {
  return {
    from(table: keyof Db) {
      const rows = db[table];
      const select = () => {
        const filters: [string, unknown][] = [];
        const matching = () => rows.filter((r) => !r._hidden && filters.every(([c, v]) => r[c] === v));
        const q = {
          eq(col: string, value: unknown) {
            filters.push([col, value]);
            return q;
          },
          maybeSingle: async () => ({ data: matching()[0] ?? null }),
          then: (resolve: (v: { data: Row[] }) => unknown) => resolve({ data: matching() }),
        };
        return q;
      };
      return {
        select,
        insert: async (row: Row) => {
          if (UNIQUE[table]?.(row, rows)) return { error: { code: "23505", message: "duplicate" } };
          rows.push({ id: row.id ?? `row${nextId++}`, ...row });
          return { error: null };
        },
        update: (patch: Row) => ({
          eq: async (col: string, value: unknown) => {
            for (const r of rows.filter((x) => x[col] === value)) Object.assign(r, patch);
            return { error: null };
          },
        }),
      };
    },
  } as never;
}

// A paid invoice: the original card payment of $1,130 (pi_1) is on the books.
function paidDb(): Db {
  const db = makeDb();
  db.payments.push({
    id: "pay1",
    document_id: "doc1",
    amount: 1130,
    paid_date: "2026-09-10",
    method: "Card (online)",
    source: "stripe",
    stripe_account_id: "acct_1",
    stripe_payment_intent_id: "pi_1",
    stripe_refund_id: null,
    stripe_dispute_id: null,
  });
  return db;
}

const doc = (db: Db) => db.documents[0];
const reversals = (db: Db) => db.payments.filter((p) => p.source === "stripe_refund" || p.source === "stripe_dispute");
const signedTotal = (db: Db) => db.payments.reduce((s, p) => s + (p.amount as number), 0);

const charge: ChargeLike = { id: "ch_1", currency: "cad", payment_intent: "pi_1", metadata: { document_id: "doc1" } };
const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const refund = (id: string, dollars: number, iso = "2026-09-12T15:00:00Z", extra: Partial<RefundLike> = {}): RefundLike => ({
  id,
  amount: Math.round(dollars * 100),
  status: "succeeded",
  created: at(iso),
  currency: "cad",
  metadata: {},
  ...extra,
});

function refundDeps(refunds: RefundLike[], over: { charge?: ChargeLike; now?: string } = {}) {
  return {
    now: () => new Date(over.now ?? "2026-10-20T15:00:00Z"),
    retrieveCharge: async () => over.charge ?? charge,
    listRefunds: async () => refunds,
  };
}

const chargeObject = { id: "ch_1", object: "charge" };

// ------------------------------------------------------------------ pure rules

test("a reversal can never take more than the payment still holds", () => {
  assert.equal(reversalCapacity(1130, []), 1130);
  assert.equal(reversalCapacity(1130, [-300, -200]), 630);
  assert.equal(reversalCapacity(100, [-100, -50]), 0);
  assert.deepEqual(planReversal(300, 630), { amount: 300, capped: false });
  assert.deepEqual(planReversal(700, 630), { amount: 630, capped: true });
  assert.equal(planReversal(50, 0), null);
});

test("our own excess refund is recognised by its flag or by the stored refund id", () => {
  const plain = refund("re_1", 10);
  assert.equal(isExcessRefund(plain, null), false);
  assert.equal(isExcessRefund({ ...plain, metadata: { [EXCESS_REFUND_FLAG]: "1" } }, null), true);
  assert.equal(isExcessRefund(plain, { refund_id: "re_1" }), true);
  assert.equal(isExcessRefund(plain, { refund_id: "re_other" }), false);
  assert.equal(isExcessRefund(plain, { refund_id: null }), false);
});

test("dispute statuses: open ones keep the banner on, every closed one turns it off", () => {
  for (const s of ["warning_needs_response", "warning_under_review", "needs_response", "under_review"]) {
    assert.equal(isDisputeOpen(s), true, s);
  }
  for (const s of ["won", "lost", "warning_closed", "charge_refunded"]) assert.equal(isDisputeOpen(s), false, s);
});

test("Stripe Dashboard links use test/ outside live mode and nothing else about the client", () => {
  assert.equal(disputeStripeUrl("dp_1", true), "https://dashboard.stripe.com/disputes/dp_1");
  assert.equal(disputeStripeUrl("dp_1", false), "https://dashboard.stripe.com/test/disputes/dp_1");
  assert.equal(excessRefundKey("pi_1"), "taxsnap-excess-pi_1");
});

test("payment lines read Refund / Dispute lost for Stripe reversals only", () => {
  assert.equal(paymentKindLabel({ source: "stripe_refund", amount: -30 }), "Refund");
  assert.equal(paymentKindLabel({ source: "stripe_dispute", amount: -1130 }), "Dispute lost");
  assert.equal(paymentKindLabel({ source: "stripe", amount: 1130 }), null);
  assert.equal(paymentKindLabel({ source: "manual", amount: 50 }), null);
  assert.equal(paymentKind({ source: "stripe_refund", amount: -1 }), "refund");
});

// ------------------------------------------------------------------ refunds

test("a refund becomes a negative payment row, dated on the refund and linked to it; the invoice goes partial", async () => {
  const db = paidDb();
  const result = await processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps([refund("re_1", 30)]));
  assert.deepEqual(result, { status: "processed", recorded: 30, skippedExcess: 0, capped: 0 });
  const [row] = reversals(db);
  assert.equal(row.amount, -30);
  assert.equal(row.source, "stripe_refund");
  assert.equal(row.stripe_refund_id, "re_1");
  assert.equal(row.stripe_payment_intent_id, "pi_1");
  assert.equal(row.document_id, "doc1");
  assert.equal(row.paid_date, "2026-09-12");
  assert.equal(doc(db).status, "partial");
});

test("several partial refunds of one payment all record (the old pi+source index would have blocked them)", async () => {
  const db = paidDb();
  const refunds = [refund("re_1", 100, "2026-09-12T15:00:00Z"), refund("re_2", 50, "2026-09-13T15:00:00Z"), refund("re_3", 25.5, "2026-09-14T15:00:00Z")];
  await processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps(refunds));
  assert.deepEqual(reversals(db).map((r) => r.amount), [-100, -50, -25.5]);
  assert.equal(Math.round(signedTotal(db) * 100) / 100, 954.5);
  assert.equal(doc(db).status, "partial");
});

test("a replayed or overlapping charge.refunded never double-records", async () => {
  const db = paidDb();
  const refunds = [refund("re_1", 100), refund("re_2", 50)];
  await processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps(refunds));
  await processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps(refunds));
  assert.equal(reversals(db).length, 2);
  // a later refund event lists the old refunds again plus the new one: only the new one is added
  const third = await processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps([...refunds, refund("re_3", 10)]));
  assert.equal((third as { recorded: number }).recorded, 10);
  assert.equal(reversals(db).length, 3);
});

test("the unique refund id also stops a concurrent replay that lost the race", async () => {
  const db = paidDb();
  // already committed by the other delivery, but invisible to this one's earlier read
  db.payments.push({ id: "x", document_id: "doc1", amount: -30, source: "stripe_refund", stripe_refund_id: "re_1", stripe_payment_intent_id: "pi_1", _hidden: true });
  const result = await processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps([refund("re_1", 30)]));
  assert.equal(result.status, "processed");
  assert.equal((result as { recorded: number }).recorded, 0, "treated as a duplicate, not a failure");
  assert.equal(db.payments.filter((r) => r.stripe_refund_id === "re_1").length, 1);
});

test("a fully refunded invoice goes back to unpaid (sent); a partial refund leaves it partial", async () => {
  const db = paidDb();
  await processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps([refund("re_1", 1130)]));
  assert.equal(signedTotal(db), 0);
  assert.equal(doc(db).status, "sent");
  assert.equal(statusFromPaid(0, 1130), "sent");
});

test("a refund is capped at what the payment still holds, never below zero", async () => {
  const db = paidDb();
  const result = await processChargeRefunded(
    fakeAdmin(db),
    "acct_1",
    chargeObject,
    refundDeps([refund("re_1", 1000), refund("re_2", 500)]),
  );
  assert.deepEqual(result, { status: "processed", recorded: 1130, skippedExcess: 0, capped: 1 });
  assert.equal(signedTotal(db), 0);
});

test("our own excess refund is NOT recorded (flag), and neither is one matching the stored refund id", async () => {
  const db = paidDb();
  db.stripe_overpayments.push({ payment_intent_id: "pi_1", refund_id: "re_stored" });
  const result = await processChargeRefunded(
    fakeAdmin(db),
    "acct_1",
    chargeObject,
    refundDeps([
      refund("re_flagged", 630, "2026-09-12T15:00:00Z", { metadata: { [EXCESS_REFUND_FLAG]: "1" } }),
      refund("re_stored", 10),
      refund("re_owner", 40),
    ]),
  );
  assert.deepEqual(result, { status: "processed", recorded: 40, skippedExcess: 2, capped: 0 });
  assert.deepEqual(reversals(db).map((r) => r.stripe_refund_id), ["re_owner"]);
});

test("failed and canceled refunds move no money; a pending one is recorded later (the event is retried)", async () => {
  const db = paidDb();
  const result = await processChargeRefunded(
    fakeAdmin(db),
    "acct_1",
    chargeObject,
    refundDeps([refund("re_f", 10, undefined, { status: "failed" }), refund("re_c", 10, undefined, { status: "canceled" })]),
  );
  assert.equal((result as { recorded: number }).recorded, 0);
  await assert.rejects(
    processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps([refund("re_ok", 20), refund("re_p", 10, undefined, { status: "pending" })])),
    RetryLater,
  );
  assert.deepEqual(reversals(db).map((r) => r.stripe_refund_id), ["re_ok"], "the settled one is kept, the pending one waits");
});

test("a refund that arrives BEFORE its payment is recorded is retried, not dropped", async () => {
  const db = makeDb(); // no payments yet
  await assert.rejects(
    processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps([refund("re_1", 30)])),
    RetryLater,
  );
  assert.equal(db.payments.length, 0);
});

test("a refund for a payment that was never ours, or never recorded (pure excess), is ignored", async () => {
  const foreign = await processChargeRefunded(
    fakeAdmin(makeDb()),
    "acct_1",
    chargeObject,
    refundDeps([refund("re_1", 30)], { charge: { ...charge, metadata: {} } }),
  );
  assert.deepEqual(foreign, { status: "ignored", reason: "not_a_taxsnap_payment" });
  const db = makeDb();
  db.stripe_overpayments.push({ payment_intent_id: "pi_1", refund_id: "re_x" });
  const unrecorded = await processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps([refund("re_x", 1130)]));
  assert.deepEqual(unrecorded, { status: "ignored", reason: "payment_never_recorded" });
});

test("a refund from the wrong connected account, a non-CAD charge, or a non-charge object is ignored", async () => {
  const db = paidDb();
  assert.deepEqual(
    await processChargeRefunded(fakeAdmin(db), "acct_other", chargeObject, refundDeps([refund("re_1", 30)])),
    { status: "ignored", reason: "account_mismatch" },
  );
  assert.deepEqual(
    await processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps([refund("re_1", 30)], { charge: { ...charge, currency: "usd" } })),
    { status: "ignored", reason: "not_cad" },
  );
  assert.deepEqual(await processChargeRefunded(fakeAdmin(db), "acct_1", { id: "x", object: "refund" }, refundDeps([])), {
    status: "ignored",
    reason: "not_a_charge",
  });
  assert.deepEqual(await processChargeRefunded(fakeAdmin(db), null, chargeObject, refundDeps([])), {
    status: "ignored",
    reason: "no_connected_account",
  });
  assert.equal(reversals(db).length, 0);
});

test("the refund is re-read from Stripe: the payload's own refund list is never used", async () => {
  const db = paidDb();
  let listed = 0;
  const deps = { ...refundDeps([refund("re_real", 20)]), listRefunds: async () => (listed++, [refund("re_real", 20)]) };
  await processChargeRefunded(
    fakeAdmin(db),
    "acct_1",
    { id: "ch_1", object: "charge", refunds: { data: [{ id: "re_forged", amount: 99900 }] } } as never,
    deps,
  );
  assert.equal(listed, 1);
  assert.deepEqual(reversals(db).map((r) => r.stripe_refund_id), ["re_real"]);
});

// ------------------------------------------------------------------ revenue and HST: sign and period

const revDoc = (db: Db) => ({
  subtotal: doc(db).subtotal as number,
  total_amount: doc(db).total_amount as number,
  excluded_from_hst: false,
  payments: db.payments.map((p) => ({ amount: p.amount as number, paid_date: p.paid_date as string })),
});

test("a refund in the SAME period nets against its payment (pro-rated, pre-tax)", async () => {
  const db = paidDb();
  await processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps([refund("re_1", 565, "2026-09-20T15:00:00Z")]));
  const r = recognizePayments([revDoc(db)], "2026-09-01", "2026-09-30");
  assert.equal(r.totalSales, 500); // 1000 - 500
  assert.equal(r.hstCollected, 65); // 130 - 65
});

test("a refund in a LATER period reduces that later period and leaves the earlier one untouched", async () => {
  const db = paidDb();
  await processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps([refund("re_1", 565, "2026-10-20T15:00:00Z")]));
  const september = recognizePayments([revDoc(db)], "2026-09-01", "2026-09-30");
  assert.equal(september.totalSales, 1000);
  assert.equal(september.hstCollected, 130);
  const october = recognizePayments([revDoc(db)], "2026-10-01", "2026-10-31");
  assert.equal(october.totalSales, -500);
  assert.equal(october.hstCollected, -65);
  assert.equal(recognizePayments([revDoc(db)], null, null).totalSales, 500);
});

test("the HST card and the dashboard use the same signed, per-payment, period-by-paid_date rule", () => {
  const card = read("../components/dashboard/hst-summary-card.tsx");
  assert.match(card, /payment\.paid_date < range\.start/);
  assert.match(card, /doc\.subtotal \* fraction \* payment\.amount/);
  assert.match(card, /doc\.hst_amount \* fraction \* payment\.amount/);
  assert.doesNotMatch(card, /payment\.amount\s*>\s*0/);
  assert.doesNotMatch(read("./payment-revenue.ts"), /payment.amounts*[<>]=?s*0/);
});

// ------------------------------------------------------------------ disputes

const dispute = (status: string, over: Partial<DisputeLike> = {}): DisputeLike => ({
  id: "dp_1",
  charge: "ch_1",
  payment_intent: "pi_1",
  amount: 113000,
  currency: "cad",
  status,
  balance_transactions: [{ fee: 1500 }],
  ...over,
});

function disputeDeps(d: DisputeLike, over: { charge?: ChargeLike; now?: string } = {}) {
  const notices: OwnerNotice[] = [];
  return {
    notices,
    deps: {
      now: () => new Date(over.now ?? "2026-10-20T15:00:00Z"),
      retrieveCharge: async () => over.charge ?? charge,
      retrieveDispute: async () => d,
      notifyOwner: async (n: OwnerNotice) => {
        notices.push(n);
        return true;
      },
    },
  };
}

const opened = { livemode: false, notifyOnOpen: true };
const closed = (iso: string) => ({ livemode: false, notifyOnOpen: false, eventCreated: at(iso) });
const disputeObject = { id: "dp_1", object: "dispute" };

test("a dispute OPENING reverses nothing: invoice flagged, owner emailed with the invoice number, amount and a Dashboard link", async () => {
  const db = paidDb();
  const { deps, notices } = disputeDeps(dispute("needs_response"));
  const result = await syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, deps);
  assert.equal(result.status, "synced");
  assert.equal(doc(db).payment_disputed, true);
  assert.equal(doc(db).status, "paid", "books unchanged while open");
  assert.equal(signedTotal(db), 1130);
  assert.equal(reversals(db).length, 0);
  assert.deepEqual(notices, [
    { kind: "dispute_opened", userId: "u1", documentNumber: 12, amount: 1130, disputeId: "dp_1", livemode: false },
  ]);
  assert.equal(db.stripe_disputes[0].fee, 15, "the dispute fee is stored for information only");
  assert.equal(db.stripe_disputes[0].owner_notified_at != null, true);
});

test("the owner notice carries no client details", () => {
  const email = read("./email.ts");
  const fn = email.slice(email.indexOf("export async function sendOwnerPaymentNoticeEmail"));
  assert.doesNotMatch(fn, /clientName|customer_details|ana@|client[.?]/);
  const notice = read("./online-refunds.ts");
  assert.doesNotMatch(notice.slice(notice.indexOf("export type OwnerNotice"), notice.indexOf("export interface RefundDeps")), /client|email/i);
});

test("a replayed dispute.created does not email twice and does not duplicate the dispute", async () => {
  const db = paidDb();
  const { deps, notices } = disputeDeps(dispute("needs_response"));
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, deps);
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, deps);
  assert.equal(notices.length, 1);
  assert.equal(db.stripe_disputes.length, 1);
});

test("a failed email does not fail the event; it is retried only if the event is delivered again", async () => {
  const db = paidDb();
  const { deps } = disputeDeps(dispute("needs_response"));
  const flaky = { ...deps, notifyOwner: async () => false };
  const result = await syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, flaky);
  assert.equal((result as { notified: boolean }).notified, false);
  assert.equal(doc(db).payment_disputed, true, "the banner is on regardless");
  assert.equal(db.stripe_disputes[0].owner_notified_at ?? null, null);
  const again = await syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, deps);
  assert.equal((again as { notified: boolean }).notified, true);
});

test("a LOST dispute adds a negative row for the disputed amount, dated on the loss; status and HST reverse in that period", async () => {
  const db = paidDb();
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, disputeDeps(dispute("needs_response")).deps);
  const { deps, notices } = disputeDeps(dispute("lost"));
  const result = await syncDispute(fakeAdmin(db), "acct_1", disputeObject, closed("2026-10-18T15:00:00Z"), deps);
  assert.deepEqual(result, { status: "synced", disputeStatus: "lost", reversed: 1130, notified: false });
  const [row] = reversals(db);
  assert.equal(row.amount, -1130);
  assert.equal(row.source, "stripe_dispute");
  assert.equal(row.stripe_dispute_id, "dp_1");
  assert.equal(row.paid_date, "2026-10-18", "dated on the Stripe event, not on when it was processed");
  assert.equal(row.stripe_fee, 15, "the fee rides along as information");
  assert.equal(signedTotal(db), 0, "the fee is not in the totals");
  assert.equal(doc(db).status, "sent");
  assert.equal(doc(db).payment_disputed, false);
  assert.equal(notices.length, 0, "no email on close");
  assert.equal(recognizePayments([revDoc(db)], "2026-09-01", "2026-09-30").totalSales, 1000, "September stays as it was");
  const oct = recognizePayments([revDoc(db)], "2026-10-01", "2026-10-31");
  assert.equal(oct.totalSales, -1000);
  assert.equal(oct.hstCollected, -130);
});

test("a replayed dispute.closed (lost) reverses once", async () => {
  const db = paidDb();
  const { deps } = disputeDeps(dispute("lost"));
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, closed("2026-10-18T15:00:00Z"), deps);
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, closed("2026-10-18T15:00:00Z"), deps);
  assert.equal(reversals(db).length, 1);
  assert.equal(signedTotal(db), 0);
});

test("a WON dispute clears the banner and changes nothing in the books", async () => {
  const db = paidDb();
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, disputeDeps(dispute("under_review")).deps);
  assert.equal(doc(db).payment_disputed, true);
  const result = await syncDispute(fakeAdmin(db), "acct_1", disputeObject, closed("2026-10-25T15:00:00Z"), disputeDeps(dispute("won")).deps);
  assert.equal((result as { reversed: number }).reversed, 0);
  assert.equal(doc(db).payment_disputed, false);
  assert.equal(doc(db).status, "paid");
  assert.equal(signedTotal(db), 1130);
  assert.equal(reversals(db).length, 0);
  assert.equal(db.stripe_disputes[0].status, "won");
});

test("closed arriving before created ends in the same place: no banner, no late email", async () => {
  const db = paidDb();
  const won = disputeDeps(dispute("won"));
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, closed("2026-10-25T15:00:00Z"), won.deps);
  // the late "created" event re-reads the dispute, which is already won
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, won.deps);
  assert.equal(doc(db).payment_disputed, false);
  assert.equal(won.notices.length, 0);
  assert.equal(db.stripe_disputes.length, 1);
});

test("the banner stays on while ANY dispute of the invoice is open", async () => {
  const db = paidDb();
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, disputeDeps(dispute("needs_response")).deps);
  await syncDispute(fakeAdmin(db), "acct_1", { id: "dp_2", object: "dispute" }, opened, disputeDeps(dispute("needs_response", { id: "dp_2", amount: 1000 })).deps);
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, closed("2026-10-25T15:00:00Z"), disputeDeps(dispute("won")).deps);
  assert.equal(doc(db).payment_disputed, true);
  await syncDispute(fakeAdmin(db), "acct_1", { id: "dp_2", object: "dispute" }, closed("2026-10-26T15:00:00Z"), disputeDeps(dispute("won", { id: "dp_2", amount: 1000 })).deps);
  assert.equal(doc(db).payment_disputed, false);
});

test("a dispute that arrives before its payment is recorded is retried, not dropped", async () => {
  const db = makeDb();
  await assert.rejects(
    syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, disputeDeps(dispute("needs_response")).deps),
    RetryLater,
  );
  assert.equal(db.stripe_disputes.length, 0);
  assert.equal(doc(db).payment_disputed, false);
});

test("a dispute on someone else's charge, the wrong account or a non-CAD charge is ignored", async () => {
  const db = paidDb();
  const foreign = await syncDispute(fakeAdmin(makeDb()), "acct_1", disputeObject, opened, disputeDeps(dispute("needs_response"), { charge: { ...charge, metadata: {} } }).deps);
  assert.deepEqual(foreign, { status: "ignored", reason: "not_a_taxsnap_payment" });
  const wrong = await syncDispute(fakeAdmin(db), "acct_other", disputeObject, opened, disputeDeps(dispute("needs_response")).deps);
  assert.deepEqual(wrong, { status: "ignored", reason: "account_mismatch" });
  const usd = await syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, disputeDeps(dispute("needs_response"), { charge: { ...charge, currency: "usd" } }).deps);
  assert.deepEqual(usd, { status: "ignored", reason: "not_cad" });
  assert.equal(db.stripe_disputes.length, 0);
});

test("a lost dispute after a partial refund reverses only what the payment still holds", async () => {
  const db = paidDb();
  await processChargeRefunded(fakeAdmin(db), "acct_1", chargeObject, refundDeps([refund("re_1", 330)]));
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, closed("2026-10-18T15:00:00Z"), disputeDeps(dispute("lost")).deps);
  assert.equal(signedTotal(db), 0, "never below zero");
  assert.deepEqual(reversals(db).map((r) => r.amount), [-330, -800]);
});

// ------------------------------------------------------------------ the double-payment guard

function excessDeps(over: Partial<{ fail: number; existing: { id: string } | null }> = {}) {
  const created: Record<string, unknown>[] = [];
  const notices: OwnerNotice[] = [];
  let fail = over.fail ?? 0;
  return {
    created,
    notices,
    deps: {
      findExcessRefund: async () => over.existing ?? null,
      refundExcess: async (args: Record<string, unknown>) => {
        if (fail > 0) {
          fail -= 1;
          throw new Error("stripe is down");
        }
        created.push(args);
        return { id: "re_excess" };
      },
      notifyOwner: async (n: OwnerNotice) => {
        notices.push(n);
        return true;
      },
    },
  };
}

const excessInput = { documentId: "doc1", userId: "u1", documentNumber: 12, accountId: "acct_1", paymentIntentId: "pi_2", amountPaid: 1130, amountRecorded: 500, livemode: false };

test("the excess of a double payment is refunded once on the connected account, with an idempotency key, and the owner is told", async () => {
  const db = paidDb();
  const { deps, created, notices } = excessDeps();
  const result = await settleExcess(fakeAdmin(db), excessInput, deps);
  assert.deepEqual(result, { excess: 630, refunded: true });
  assert.deepEqual(created, [
    { paymentIntentId: "pi_2", accountId: "acct_1", cents: 63000, idempotencyKey: "taxsnap-excess-pi_2", documentId: "doc1" },
  ]);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, "excess_refunded");
  assert.deepEqual(
    { status: db.stripe_overpayments[0].refund_status, refund: db.stripe_overpayments[0].refund_id, excess: db.stripe_overpayments[0].amount_excess },
    { status: "refunded", refund: "re_excess", excess: 630 },
  );
});

test("a replay never refunds or emails twice", async () => {
  const db = paidDb();
  const { deps, created, notices } = excessDeps();
  await settleExcess(fakeAdmin(db), excessInput, deps);
  await settleExcess(fakeAdmin(db), excessInput, deps);
  assert.equal(created.length, 1);
  assert.equal(notices.length, 1);
});

test("a refund already made (Stripe forgets idempotency keys after 24 h) is adopted, not repeated", async () => {
  const db = paidDb();
  const { deps, created } = excessDeps({ existing: { id: "re_already" } });
  await settleExcess(fakeAdmin(db), excessInput, deps);
  assert.equal(created.length, 0);
  assert.equal(db.stripe_overpayments[0].refund_id, "re_already");
});

test("a failed refund tells the owner once, marks the row failed, and throws so Stripe retries; the retry succeeds", async () => {
  const db = paidDb();
  const { deps, created, notices } = excessDeps({ fail: 2 });
  await assert.rejects(settleExcess(fakeAdmin(db), excessInput, deps), /stripe is down/);
  assert.equal(db.stripe_overpayments[0].refund_status, "failed");
  await assert.rejects(settleExcess(fakeAdmin(db), excessInput, deps), /stripe is down/);
  assert.deepEqual(notices.map((n) => n.kind), ["excess_refund_failed"], "one failure notice, not one per retry");
  const done = await settleExcess(fakeAdmin(db), excessInput, deps);
  assert.equal(done.refunded, true);
  assert.equal(created.length, 1);
  assert.deepEqual(notices.map((n) => n.kind), ["excess_refund_failed", "excess_refunded"]);
});

test("nothing is refunded when nothing was over-credited", async () => {
  const { deps, created } = excessDeps();
  assert.deepEqual(await settleExcess(fakeAdmin(paidDb()), { ...excessInput, amountRecorded: 1130 }, deps), { excess: 0, refunded: false });
  assert.equal(created.length, 0);
});

// whole flow through the webhook dispatcher, with the checkout fake from a real invoice

function fullDeps(db: Db, refundsFor: () => RefundLike[], extra: Partial<ConnectEventDeps> = {}) {
  const ex = excessDeps();
  const receipts: unknown[] = [];
  const d: ConnectEventDeps = {
    now: () => new Date("2026-10-20T15:00:00Z"),
    fetchFee: async () => null,
    sendReceipt: async (a) => (receipts.push(a), true),
    retrieveAccount: async (id) => ({ id }),
    retrieveCharge: async (id) => ({ id, currency: "cad", payment_intent: id === "ch_2" ? "pi_2" : "pi_1", metadata: { document_id: "doc1" } }),
    listRefunds: async () => refundsFor(),
    retrieveDispute: async () => {
      throw new Error("no dispute");
    },
    ...ex.deps,
    ...extra,
  };
  return { d, ex, receipts, db };
}

// An admin whose documents select also returns the nested rows processCheckoutCompleted reads.
function checkoutAdmin(db: Db) {
  const base = fakeAdmin(db) as unknown as { from: (t: string) => Record<string, (...a: never[]) => unknown> };
  return {
    from(table: string) {
      const t = base.from(table);
      if (table !== "documents") return t;
      return {
        ...t,
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { ...doc(db), payments: db.payments.map((p) => ({ amount: p.amount, source: p.source, stripe_payment_intent_id: p.stripe_payment_intent_id })) },
            }),
          }),
        }),
      };
    },
  } as never;
}

const sessionFor = (pi: string, cents: number) => ({
  object: "checkout.session",
  id: `cs_${pi}`,
  mode: "payment",
  payment_status: "paid",
  currency: "cad",
  amount_total: cents,
  payment_intent: pi,
  metadata: { document_id: "doc1" },
});

test("double payment, end to end: only the balance is recorded, the excess is refunded, and that refund adds NO negative row", async () => {
  const db = makeDb();
  db.documents[0].status = "sent";
  // $500 was already paid manually; a second online session pays the full $1,130
  db.payments.push({ id: "m1", document_id: "doc1", amount: 500, paid_date: "2026-10-01", source: "manual", stripe_payment_intent_id: null });
  const { d, ex } = fullDeps(db, () => [refund("re_excess", 500, "2026-10-20T15:00:00Z", { metadata: { [EXCESS_REFUND_FLAG]: "1" } })]);
  const result = await processCheckoutCompleted(checkoutAdmin(db), "acct_1", sessionFor("pi_2", 113000), d);
  assert.equal(result.status, "recorded");
  assert.equal((result as { amount: number }).amount, 630);
  assert.equal((result as { overpaid: number }).overpaid, 500);
  assert.equal(ex.created[0].cents, 50000);
  assert.equal(doc(db).status, "paid");

  // Stripe now sends charge.refunded for the excess refund we just made
  const note = await handleConnectEvent(
    checkoutAdmin(db),
    { type: "charge.refunded", account: "acct_1", data: { object: { id: "ch_2", object: "charge" } } },
    d,
  );
  assert.equal(note, "excess_refund_not_recorded");
  assert.equal(reversals(db).length, 0, "the excess was never recorded, so its refund is not a ledger event");
  assert.equal(signedTotal(db), 1130);
  assert.equal(doc(db).status, "paid");
});

test("a normal refund of the same payment IS mirrored, even though an excess refund exists on the charge", async () => {
  const db = makeDb();
  db.payments.push({ id: "m1", document_id: "doc1", amount: 500, paid_date: "2026-10-01", source: "manual", stripe_payment_intent_id: null });
  const refunds: RefundLike[] = [refund("re_excess", 500, "2026-10-20T15:00:00Z", { metadata: { [EXCESS_REFUND_FLAG]: "1" } })];
  const { d } = fullDeps(db, () => refunds);
  await processCheckoutCompleted(checkoutAdmin(db), "acct_1", sessionFor("pi_2", 113000), d);
  refunds.push(refund("re_owner", 100, "2026-10-22T15:00:00Z"));
  await handleConnectEvent(checkoutAdmin(db), { type: "charge.refunded", account: "acct_1", data: { object: { id: "ch_2", object: "charge" } } }, d);
  assert.deepEqual(reversals(db).map((r) => [r.stripe_refund_id, r.amount]), [["re_owner", -100]]);
  assert.equal(doc(db).status, "partial");
});

test("a replayed checkout event after the first payment was refunded still treats the second as pure excess", async () => {
  const db = paidDb(); // $1,130 online payment pi_1
  const { d, ex } = fullDeps(db, () => []);
  const first = await processCheckoutCompleted(checkoutAdmin(db), "acct_1", sessionFor("pi_2", 113000), d);
  assert.equal(first.status, "skipped");
  // the owner now refunds pi_1 in full, so the invoice has a balance again...
  db.payments.push({ id: "r1", document_id: "doc1", amount: -1130, source: "stripe_refund", stripe_refund_id: "re_1", stripe_payment_intent_id: "pi_1", paid_date: "2026-10-21" });
  // ...but a replay of the second payment must not record it (it was already refunded as excess)
  const replay = await processCheckoutCompleted(checkoutAdmin(db), "acct_1", sessionFor("pi_2", 113000), d);
  assert.equal(replay.status, "skipped");
  assert.equal(db.payments.filter((p) => p.stripe_payment_intent_id === "pi_2").length, 0);
  assert.equal(ex.created.length, 1, "refunded once");
});

test("the webhook dispatcher routes the three new events and re-reads from Stripe", async () => {
  const db = paidDb();
  const { d } = fullDeps(db, () => [refund("re_1", 30)], { retrieveDispute: async () => dispute("lost") });
  assert.equal(
    await handleConnectEvent(fakeAdmin(db), { type: "charge.refunded", account: "acct_1", data: { object: { id: "ch_1", object: "charge" } } }, d),
    null,
  );
  assert.equal(reversals(db).length, 1);
  await handleConnectEvent(
    fakeAdmin(db),
    { type: "charge.dispute.closed", account: "acct_1", created: at("2026-10-18T15:00:00Z"), livemode: false, data: { object: { id: "dp_1", object: "dispute" } } },
    d,
  );
  assert.equal(reversals(db).length, 2);
  assert.equal(doc(db).payment_disputed, false);
  assert.equal(
    await handleConnectEvent(fakeAdmin(db), { type: "charge.refunded", account: "acct_1", data: { object: { id: "ch_9", object: "charge" } } }, {
      ...d,
      retrieveCharge: async () => ({ id: "ch_9", currency: "cad", payment_intent: "pi_x", metadata: {} }),
    }),
    "ignored:not_a_taxsnap_payment",
  );
});

// ------------------------------------------------------------------ locks, CSV, wiring

test("refund and dispute rows can't be edited or deleted in the app, like the card payments", async () => {
  const dbFor = (source: string) =>
    ({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { source } }) }) }) }) }),
    }) as never;
  assert.equal(await stripePaymentLockMessage(dbFor("stripe_refund"), "d", "p"), STRIPE_REVERSAL_LOCKED_MESSAGE);
  assert.equal(await stripePaymentLockMessage(dbFor("stripe_dispute"), "d", "p"), STRIPE_REVERSAL_LOCKED_MESSAGE);
  assert.equal(await stripePaymentLockMessage(dbFor("stripe"), "d", "p"), STRIPE_PAYMENT_LOCKED_MESSAGE);
  assert.equal(await stripePaymentLockMessage(dbFor("manual"), "d", "p"), null);
  const route = read("../app/api/documents/[id]/payments/[paymentId]/route.ts");
  assert.equal((route.match(/stripePaymentLockMessage\(/g) ?? []).length, 2, "PATCH and DELETE both check");
});

test("the QuickBooks CSV writes a refund in the Payment column as a labelled positive, never a negative deposit", () => {
  const csv = receiptsToQuickBooksCsv([], [
    { paidDate: "2026-09-10", documentNumber: 12, clientName: "Ana", amount: 1130 },
    { paidDate: "2026-10-20", documentNumber: 12, clientName: "Ana", amount: -565 },
  ]);
  const lines = csv.split("\n");
  assert.match(lines[1], /,,1130\.00$/);
  assert.match(lines[2], /Refund - Invoice .*,565\.00,$/);
  assert.doesNotMatch(csv, /-565/);
});

test("the webhook handles exactly the new events, with the same safeguards as before", () => {
  const route = read("../app/api/stripe/connect-webhook/route.ts");
  for (const e of ["charge.refunded", "charge.dispute.created", "charge.dispute.closed"]) assert.match(route, new RegExp(e.replace(/\./g, "\\.")));
  assert.match(route, /constructEvent\(/);
  assert.match(route, /eventMatchesKeyMode\(/);
  assert.match(route, /claimEvent\(/);
  assert.match(route, /status: 500/);
  const dispatch = read("./online-payments.ts");
  assert.match(dispatch, /case "charge\.refunded"/);
  assert.match(dispatch, /case "charge\.dispute\.created"/);
  assert.match(dispatch, /case "charge\.dispute\.closed"/);
  // the account must match the invoice's owner before anything is written, and objects are re-read by id
  const refunds = read("./online-refunds.ts");
  assert.match(refunds, /profile\.stripe_connect_account_id !== accountId/);
  assert.match(refunds, /deps\.retrieveDispute\(/);
  assert.match(refunds, /deps\.listRefunds\(/);
});

test("the only Stripe write is the excess refund: idempotent and flagged", () => {
  const src = read("./stripe-connect.ts");
  assert.equal((src.match(/refunds\.create\(/g) ?? []).length, 1);
  assert.doesNotMatch(src, /disputes\.(update|close)|charges\.(create|capture)|transfers\.create|payouts\.create/);
  assert.match(src, /idempotencyKey: args\.idempotencyKey/);
  assert.match(src, /\[EXCESS_REFUND_FLAG\]: "1"/);
  assert.match(src, /stripeAccount: args\.accountId/);
});

test("0069 replaces the unique index, constrains the sign, adds the dispute flag, and has a safe rollback", () => {
  const up = read("../../supabase/migrations/0069_online_payments_refunds_disputes.sql");
  assert.match(up, /drop index if exists public\.payments_stripe_pi_source_uniq/);
  assert.match(up, /payments_stripe_pi_uniq[\s\S]*where source = 'stripe'/);
  assert.match(up, /payments_stripe_refund_uniq[\s\S]*stripe_refund_id/);
  assert.match(up, /payments_stripe_dispute_uniq/);
  assert.match(up, /'manual','stripe','stripe_refund','stripe_dispute'/);
  assert.match(up, /source = 'stripe_refund' and amount < 0/);
  assert.match(up, /payment_disputed boolean not null default false/);
  assert.match(up, /stripe_disputes[\s\S]*enable row level security/);
  assert.match(up, /stripe_overpayments[\s\S]*enable row level security/);
  assert.doesNotMatch(up, /create policy/i, "the new tables are service role only");
  const down = read("../../supabase/rollbacks/0069_online_payments_refunds_disputes_rollback.sql");
  assert.match(down, /raise exception/, "refuses to drop real refund rows");
  assert.match(down, /payments_stripe_pi_source_uniq/);
  assert.match(down, /drop table if exists public\.stripe_overpayments/);
});

test("the invoice shows the disputed banner, the list and preview show a badge, and refund lines are red", () => {
  const detail = read("../components/invoices/document-detail.tsx");
  assert.match(detail, /doc\.payment_disputed &&/);
  assert.match(detail, /PAYMENT_DISPUTED_LABEL/);
  assert.match(detail, /payment\.amount < 0 \? "text-destructive"/);
  assert.match(detail, /paymentKindLabel\(payment\)/);
  assert.match(read("../components/invoices/document-list.tsx"), /doc\.payment_disputed &&/);
  assert.match(read("../components/invoices/document-workstation.tsx"), /doc\.payment_disputed &&/);
});

// ------------------------------------------------------------------ matching: payment intent first, metadata only a fallback

const noMeta: ChargeLike = { id: "ch_1", currency: "cad", payment_intent: "pi_1" }; // metadata missing entirely

test("a refund finds its payment through the charge's payment_intent even when the charge has NO metadata", async () => {
  for (const metadata of [undefined, null, {}] as const) {
    const db = paidDb();
    const result = await processChargeRefunded(
      fakeAdmin(db),
      "acct_1",
      chargeObject,
      refundDeps([refund("re_1", 30)], { charge: { ...noMeta, metadata } }),
    );
    assert.equal(result.status, "processed");
    assert.deepEqual(reversals(db).map((r) => r.amount), [-30]);
  }
});

test("a dispute finds its payment through payment_intent with NO charge metadata, and a lost one reverses it", async () => {
  const db = paidDb();
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, disputeDeps(dispute("needs_response"), { charge: noMeta }).deps);
  assert.equal(doc(db).payment_disputed, true);
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, closed("2026-10-18T15:00:00Z"), disputeDeps(dispute("lost"), { charge: noMeta }).deps);
  assert.equal(signedTotal(db), 0);
});

test("the payment intent wins over metadata: wrong metadata can not send a refund to another invoice", async () => {
  const db = paidDb();
  db.documents.push({ ...db.documents[0], id: "doc2", document_number: 13 });
  const result = await processChargeRefunded(
    fakeAdmin(db),
    "acct_1",
    chargeObject,
    refundDeps([refund("re_1", 30)], { charge: { ...charge, metadata: { document_id: "doc2" } } }),
  );
  assert.equal(result.status, "processed");
  assert.deepEqual(reversals(db).map((r) => r.document_id), ["doc1"]);
});

test("metadata is only the fallback: no payment row + no metadata is ignored, no payment row + metadata is retried", async () => {
  const bare = await processChargeRefunded(fakeAdmin(makeDb()), "acct_1", chargeObject, refundDeps([refund("re_1", 30)], { charge: noMeta }));
  assert.deepEqual(bare, { status: "ignored", reason: "not_a_taxsnap_payment" });
  await assert.rejects(
    processChargeRefunded(fakeAdmin(makeDb()), "acct_1", chargeObject, refundDeps([refund("re_1", 30)])),
    RetryLater,
  );
  const code = read("./online-refunds.ts");
  const lookup = code.indexOf('.eq("stripe_payment_intent_id", paymentIntentId)');
  const fallback = code.indexOf("charge.metadata?.document_id");
  assert.ok(lookup > 0 && fallback > lookup, "the payment_intent lookup comes first, metadata after it");
});

// ------------------------------------------------------------------ Pay now while a dispute is open

import { onlinePayableAmount } from "./connect-status.ts";

test("Pay now is hidden while a dispute is open and back once it is closed", async () => {
  const payable = (disputed: boolean) =>
    onlinePayableAmount({ type: "invoice", status: "partial", total: 1130, paid: 500, connectStatus: "active", chargesEnabled: true, hasAccount: true, disputed });
  assert.equal(payable(false), 630);
  assert.equal(payable(true), null);
  const db = paidDb();
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, opened, disputeDeps(dispute("needs_response")).deps);
  assert.equal(doc(db).payment_disputed, true);
  await syncDispute(fakeAdmin(db), "acct_1", disputeObject, closed("2026-10-25T15:00:00Z"), disputeDeps(dispute("won")).deps);
  assert.equal(doc(db).payment_disputed, false);
});

test("the checkout route and the public page both read the flag and pass it to the same rule", () => {
  const route = read("../app/api/public/invoice/[token]/checkout/route.ts");
  assert.match(route, /payment_disputed/);
  assert.match(route, /disputed: doc\.payment_disputed/);
  const page = read("../app/invoice/[token]/page.tsx");
  assert.match(page, /payment_disputed/);
  assert.match(page, /disputed: invoice\.payment_disputed/);
});

// ------------------------------------------------------------------ 0070: payments RLS

test("0070 limits owner update/delete to manual payments, adds the missing update policy, and has a rollback", () => {
  const up = read("../../supabase/migrations/0070_payments_rls_manual_only.sql");
  assert.match(up, /create policy "Users can update own manual payments"[\s\S]*for update[\s\S]*using \([\s\S]*source = 'manual'[\s\S]*with check \([\s\S]*source = 'manual'/);
  assert.match(up, /create policy "Users can delete own manual payments"[\s\S]*for delete[\s\S]*source = 'manual'/);
  assert.match(up, /create policy "Users can insert own manual payments"[\s\S]*for insert[\s\S]*with check \([\s\S]*source = 'manual'/);
  assert.equal((up.match(/d\.user_id = auth\.uid\(\)/g) ?? []).length, 4, "every policy still checks ownership through the invoice");
  assert.match(up, /cmd in \('INSERT', 'UPDATE', 'DELETE', 'ALL'\)/, "any hand-made broad policy is removed first");
  assert.doesNotMatch(up, /for select/i, "select is untouched");
  const down = read("../../supabase/rollbacks/0070_payments_rls_manual_only_rollback.sql");
  assert.match(down, /drop policy if exists "Users can insert own manual payments"/);
  assert.match(down, /create policy "Users can insert own payments"/);
  assert.match(down, /drop policy if exists "Users can update own manual payments"/);
  assert.match(down, /drop policy if exists "Users can delete own manual payments"/);
  assert.match(down, /create policy "Users can delete own payments"/);
});

test("the app's two manual insert paths never name a source, so the default 'manual' satisfies the insert policy", () => {
  for (const f of ["../app/api/documents/[id]/payments/route.ts", "../app/api/jobs/[id]/allocate-payment/route.ts"]) {
    const src = read(f);
    const insert = src.slice(src.indexOf('.from("payments")'));
    assert.doesNotMatch(insert.slice(0, insert.indexOf("})")), /source/, f);
    assert.doesNotMatch(src, /createAdminClient/, f);
  }
  assert.match(read("../../supabase/migrations/0067_online_payments_connect.sql"), /add column if not exists source text not null default 'manual'/);
});

test("the app edits and deletes payments only through the owner's session, and only manual ones pass the app lock", () => {
  const route = read("../app/api/documents/[id]/payments/[paymentId]/route.ts");
  assert.doesNotMatch(route, /createAdminClient|service/i, "the manual routes use the RLS client, which 0070 allows for manual rows");
  assert.equal((route.match(/stripePaymentLockMessage\(/g) ?? []).length, 2);
  // Stripe rows are written by the webhook with the service role, which bypasses RLS.
  assert.match(read("../app/api/stripe/connect-webhook/route.ts"), /createAdminClient\(\)/);
});

test("a real-database test proves the policy (RUN_DB_ISOLATION_TEST=1) and keeps the manual flow honest", () => {
  const db = read("./payments-rls-db.test.ts");
  assert.match(db, /RUN_DB_ISOLATION_TEST/);
  assert.match(db, /add, edit, delete a manual payment as the owner/);
  assert.match(db, /can NOT update or delete Stripe rows/);
});
