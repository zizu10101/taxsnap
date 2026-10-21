import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONNECT_LIVE_KEY_MESSAGE, connectKeyProblem, eventMatchesKeyMode } from "./connect-guard.ts";
import {
  CHECKOUT_KEY_BUCKET_MS,
  MIN_ONLINE_BALANCE,
  RATE_LIMIT,
  checkoutIdempotencyKey,
  CONNECT_PRODUCT_DESCRIPTION,
  connectColumns,
  connectedAccountParams,
  connectStatusFromAccount,
  hstPortion,
  isRateLimited,
  onlinePayableAmount,
  toCents,
} from "./connect-status.ts";
import { hashForRateLimit } from "./rate-limit-hash.ts";
import { markInvoiceShared } from "./mark-invoice-sent.ts";
import {
  claimEvent,
  handleConnectEvent,
  planStripePayment,
  processCheckoutCompleted,
  readPaidSession,
  receiptRecipient,
  recordCheckoutAttempt,
  type ConnectEventDeps,
} from "./online-payments.ts";
import { DRAFT_AFTER_SESSION_MESSAGE, draftBlockedMessage, stripePaymentLockMessage } from "./stripe-payment-lock.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ------------------------------------------------------------------ the live-key guard

test("a live key is refused outside production, allowed in production", () => {
  assert.equal(connectKeyProblem("sk_live_abc", { NODE_ENV: "development" }), CONNECT_LIVE_KEY_MESSAGE);
  assert.equal(connectKeyProblem("sk_live_abc", { NODE_ENV: "test" }), CONNECT_LIVE_KEY_MESSAGE);
  assert.equal(connectKeyProblem("sk_live_abc", {}), CONNECT_LIVE_KEY_MESSAGE);
  assert.equal(connectKeyProblem("sk_live_abc", { NODE_ENV: "production" }), null);
  assert.equal(connectKeyProblem("sk_live_abc", { NODE_ENV: "production", VERCEL_ENV: "production" }), null);
});

test("a Vercel preview build (NODE_ENV=production) still refuses a live key", () => {
  assert.equal(
    connectKeyProblem("sk_live_abc", { NODE_ENV: "production", VERCEL_ENV: "preview" }),
    CONNECT_LIVE_KEY_MESSAGE,
  );
});

test("a test key works everywhere, and a missing key is an error", () => {
  assert.equal(connectKeyProblem("sk_test_abc", { NODE_ENV: "development" }), null);
  assert.equal(connectKeyProblem("sk_test_abc", { NODE_ENV: "production", VERCEL_ENV: "preview" }), null);
  assert.match(connectKeyProblem(undefined, { NODE_ENV: "production" }) ?? "", /not set/);
});

test("webhook events must match the key's mode", () => {
  assert.equal(eventMatchesKeyMode(true, "sk_live_x"), true);
  assert.equal(eventMatchesKeyMode(false, "sk_live_x"), false);
  assert.equal(eventMatchesKeyMode(false, "sk_test_x"), true);
  assert.equal(eventMatchesKeyMode(true, "sk_test_x"), false);
});

test("every Connect entry point goes through the guarded Stripe client", () => {
  assert.match(read("./stripe-connect.ts"), /connectKeyProblem\(/);
  for (const f of [
    "../app/api/stripe/connect/start/route.ts",
    "../app/api/stripe/connect/refresh/route.ts",
    "../app/api/stripe/connect/return/route.ts",
    "../app/api/stripe/connect-webhook/route.ts",
    "../app/api/public/invoice/[token]/checkout/route.ts",
  ]) {
    const src = read(f);
    assert.match(src, /getConnectStripe\(\)/, f);
    assert.doesNotMatch(src, /getStripe\(\)/, `${f} must not bypass the guard`);
  }
  assert.match(read("../../CLAUDE.md"), /sk_test_/);
  assert.match(read("../../CLAUDE.md"), /Taxsnap sandbox/);
});

// ------------------------------------------------------------------ account status

test("account status: incomplete, active, restricted", () => {
  assert.equal(connectStatusFromAccount({ details_submitted: false, charges_enabled: false }), "incomplete");
  assert.equal(connectStatusFromAccount({ details_submitted: true, charges_enabled: true, country: "CA" }), "active");
  assert.equal(connectStatusFromAccount({ details_submitted: true, charges_enabled: false, country: "CA" }), "restricted");
  assert.equal(connectStatusFromAccount({ details_submitted: false, charges_enabled: true }), "incomplete");
});

test("account status: Canada and CAD only", () => {
  assert.equal(connectStatusFromAccount({ details_submitted: true, charges_enabled: true, country: "US" }), "restricted");
  assert.equal(
    connectStatusFromAccount({ details_submitted: true, charges_enabled: true, country: "CA", default_currency: "usd" }),
    "restricted",
  );
  assert.equal(
    connectStatusFromAccount({ details_submitted: true, charges_enabled: true, country: "CA", default_currency: "cad" }),
    "active",
  );
});

test("stored columns: charges_enabled is true only for an active account", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const active = connectColumns({ details_submitted: true, charges_enabled: true, payouts_enabled: true, country: "CA" }, now);
  assert.deepEqual(
    [active.stripe_connect_status, active.stripe_connect_charges_enabled, active.stripe_connect_payouts_enabled],
    ["active", true, true],
  );
  const restricted = connectColumns({ details_submitted: true, charges_enabled: false, payouts_enabled: true }, now);
  assert.deepEqual(
    [restricted.stripe_connect_status, restricted.stripe_connect_charges_enabled, restricted.stripe_connect_payouts_enabled],
    ["restricted", false, false],
  );
  assert.equal(active.stripe_connect_checked_at, now.toISOString());
});

// ------------------------------------------------------------------ who can pay what

const ok = {
  type: "invoice",
  status: "sent",
  total: 1130,
  paid: 0,
  connectStatus: "active",
  chargesEnabled: true,
  hasAccount: true,
  disputed: false,
};

test("Pay now: the full balance of a sent invoice on an active account", () => {
  assert.equal(onlinePayableAmount(ok), 1130);
  assert.equal(onlinePayableAmount({ ...ok, status: "partial", paid: 500 }), 630);
});

test("Pay now is hidden for a draft, a paid invoice, an estimate, or an unready account", () => {
  assert.equal(onlinePayableAmount({ ...ok, status: "draft" }), null);
  assert.equal(onlinePayableAmount({ ...ok, status: "paid", paid: 1130 }), null);
  assert.equal(onlinePayableAmount({ ...ok, type: "estimate" }), null);
  assert.equal(onlinePayableAmount({ ...ok, connectStatus: "restricted" }), null);
  assert.equal(onlinePayableAmount({ ...ok, connectStatus: "incomplete" }), null);
  assert.equal(onlinePayableAmount({ ...ok, connectStatus: "disconnected" }), null);
  assert.equal(onlinePayableAmount({ ...ok, chargesEnabled: false }), null);
  assert.equal(onlinePayableAmount({ ...ok, hasAccount: false }), null);
});

test("Pay now needs a balance OVER $1", () => {
  assert.equal(MIN_ONLINE_BALANCE, 1);
  assert.equal(onlinePayableAmount({ ...ok, total: 1, paid: 0 }), null);
  assert.equal(onlinePayableAmount({ ...ok, total: 1.01, paid: 0 }), 1.01);
  assert.equal(onlinePayableAmount({ ...ok, paid: 1129.5 }), null);
  assert.equal(onlinePayableAmount({ ...ok, paid: 1200 }), null);
});

test("cents, HST share, and the checkout key", () => {
  assert.equal(toCents(1130), 113000);
  assert.equal(toCents(10.005), 1001);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(hstPortion(1130, 1130, 130), 130);
  assert.equal(hstPortion(565, 1130, 130), 65);
  assert.equal(hstPortion(10, 0, 0), 0);
  const t = Date.UTC(2026, 9, 20, 12, 0, 0);
  const key = checkoutIdempotencyKey("doc1", 113000, t);
  assert.equal(key, checkoutIdempotencyKey("doc1", 113000, t + 1000));
  assert.notEqual(key, checkoutIdempotencyKey("doc1", 113000, t + CHECKOUT_KEY_BUCKET_MS));
  assert.notEqual(key, checkoutIdempotencyKey("doc1", 56500, t));
  assert.notEqual(key, checkoutIdempotencyKey("doc2", 113000, t));
});

test("rate limit: more than 5 per token or 20 per IP in the window", () => {
  assert.equal(RATE_LIMIT.perToken, 5);
  assert.equal(isRateLimited({ token: 5, ip: 5 }), false);
  assert.equal(isRateLimited({ token: 6, ip: 5 }), true);
  assert.equal(isRateLimited({ token: 1, ip: 20 }), false);
  assert.equal(isRateLimited({ token: 1, ip: 21 }), true);
  assert.match(hashForRateLimit("secret-token"), /^[0-9a-f]{64}$/);
  assert.notEqual(hashForRateLimit("a"), hashForRateLimit("b"));
  assert.doesNotMatch(hashForRateLimit("1.2.3.4"), /1\.2\.3\.4/);
});

// ------------------------------------------------------------------ the payment plan

test("plan: a normal payment is recorded in full", () => {
  assert.deepEqual(planStripePayment({ total: 1130, existingPaid: 0, amountPaid: 1130, alreadyRecorded: false }), {
    action: "record",
    amount: 1130,
    overpaid: 0,
  });
  assert.deepEqual(planStripePayment({ total: 1130, existingPaid: 500, amountPaid: 630, alreadyRecorded: false }), {
    action: "record",
    amount: 630,
    overpaid: 0,
  });
});

test("plan: a replay is a duplicate; a payment on a covered invoice is skipped and flagged; excess is capped", () => {
  assert.deepEqual(planStripePayment({ total: 1130, existingPaid: 1130, amountPaid: 1130, alreadyRecorded: true }), {
    action: "duplicate",
  });
  assert.deepEqual(planStripePayment({ total: 1130, existingPaid: 1130, amountPaid: 1130, alreadyRecorded: false }), {
    action: "skip",
    overpaid: 1130,
  });
  assert.deepEqual(planStripePayment({ total: 1130, existingPaid: 1000, amountPaid: 1130, alreadyRecorded: false }), {
    action: "record",
    amount: 130,
    overpaid: 1000,
  });
});

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

test("only a fully paid one-off CAD session with a document id is read", () => {
  assert.deepEqual(readPaidSession(session), {
    documentId: "doc1",
    sessionId: "cs_1",
    paymentIntentId: "pi_1",
    amount: 1130,
  });
  assert.deepEqual(readPaidSession({ ...session, payment_intent: { id: "pi_9" } })?.paymentIntentId, "pi_9");
  assert.equal(readPaidSession({ ...session, payment_status: "unpaid" }), null);
  assert.equal(readPaidSession({ ...session, mode: "subscription" }), null);
  assert.equal(readPaidSession({ ...session, currency: "usd" }), null);
  assert.equal(readPaidSession({ ...session, amount_total: 0 }), null);
  assert.equal(readPaidSession({ ...session, amount_total: 10.5 }), null);
  assert.equal(readPaidSession({ ...session, metadata: {} }), null);
  assert.equal(readPaidSession({ ...session, payment_intent: null }), null);
  assert.equal(readPaidSession({ ...session, object: "payment_intent" }), null);
});

// ------------------------------------------------------------------ recording (fake database)

interface State {
  doc: Record<string, unknown> & { payments: { amount: number; source?: string; stripe_payment_intent_id: string | null }[] };
  overpayments: Record<string, unknown>[];
  profile: Record<string, unknown> | null;
  inserted: Record<string, unknown>[];
  docUpdates: Record<string, unknown>[];
  profileUpdates: Record<string, unknown>[];
  profileMatches: boolean;
  events: Map<string, { processed_at: string | null }>;
}

function baseDoc(): State["doc"] {
  return {
    id: "doc1",
    user_id: "u1",
    type: "invoice",
    status: "sent",
    total_amount: 1130,
    document_number: 12,
    view_token: "tok",
    client: { name: "Ana", email: "ana@example.com" },
    payments: [],
  };
}

function makeState(over: Partial<State> = {}): State {
  return {
    doc: baseDoc(),
    profile: { stripe_connect_account_id: "acct_1", business_name: "Rivera Painting", subscription_status: "free" },
    inserted: [],
    overpayments: [],
    docUpdates: [],
    profileUpdates: [],
    profileMatches: true,
    events: new Map(),
    ...over,
  };
}

function fakeAdmin(state: State) {
  return {
    from(table: string) {
      if (table === "documents") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.doc }) }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              state.docUpdates.push(patch);
              return { error: null };
            },
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.profile }) }) }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              select: async () => {
                state.profileUpdates.push(patch);
                return { data: state.profileMatches ? [{ id: "p" }] : [], error: null };
              },
            }),
          }),
        };
      }
      if (table === "payments") {
        return {
          insert: async (row: Record<string, unknown>) => {
            if (state.inserted.some((r) => r.stripe_payment_intent_id === row.stripe_payment_intent_id)) {
              return { error: { code: "23505", message: "duplicate" } };
            }
            state.inserted.push(row);
            state.doc.payments.push({
              amount: row.amount as number,
              source: row.source as string,
              stripe_payment_intent_id: row.stripe_payment_intent_id as string,
            });
            return { error: null };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, id: string) => {
              Object.assign(state.inserted.find((r) => r.id === id) ?? {}, patch);
              return { error: null };
            },
          }),
        };
      }
      if (table === "stripe_overpayments") {
        return {
          select: () => ({
            eq: (_c: string, pi: string) => ({
              maybeSingle: async () => ({ data: state.overpayments.find((r) => r.payment_intent_id === pi) ?? null }),
            }),
          }),
          insert: async (row: Record<string, unknown>) => {
            if (state.overpayments.some((r) => r.payment_intent_id === row.payment_intent_id)) {
              return { error: { code: "23505", message: "dup" } };
            }
            state.overpayments.push({ refund_status: "pending", owner_notified_at: null, failure_notified_at: null, ...row });
            return { error: null };
          },
          update: (patch: Record<string, unknown>) => ({
            eq: async (_c: string, pi: string) => {
              Object.assign(state.overpayments.find((r) => r.payment_intent_id === pi) ?? {}, patch);
              return { error: null };
            },
          }),
        };
      }
      if (table === "stripe_events") {
        return {
          insert: async (row: { id: string }) => {
            if (state.events.has(row.id)) return { error: { code: "23505", message: "dup" } };
            state.events.set(row.id, { processed_at: null });
            return { error: null };
          },
          select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: state.events.get(id) ?? null }) }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

function deps(over: Partial<ConnectEventDeps> = {}) {
  const receipts: unknown[] = [];
  const refunds: Record<string, unknown>[] = [];
  const notices: Record<string, unknown>[] = [];
  const d: ConnectEventDeps = {
    now: () => new Date("2026-10-20T15:00:00Z"),
    fetchFee: async () => ({ fee: 33.07, net: 1096.93, chargeId: "ch_1" }),
    sleep: async () => {},
    sendReceipt: async (args) => {
      receipts.push(args);
      return true;
    },
    recordFeeExpense: async () => ({ status: "no_fee" as const }), // the fee expense has its own tests (stripe-fee-expense.test.ts)
    findExcessRefund: async () => null,
    refundExcess: async (args) => {
      refunds.push(args);
      return { id: "re_excess" };
    },
    notifyOwner: async (notice) => {
      notices.push(notice);
      return true;
    },
    retrieveAccount: async (id) => ({ id }),
    retrieveCharge: async () => {
      throw new Error("retrieveCharge not stubbed");
    },
    listRefunds: async () => {
      throw new Error("listRefunds not stubbed");
    },
    retrieveDispute: async () => {
      throw new Error("retrieveDispute not stubbed");
    },
    ...over,
  };
  return { d, receipts, refunds, notices };
}

test("a paid session becomes a normal payment row: amount, date, status, fee for information only", async () => {
  const state = makeState();
  const { d, receipts } = deps();
  const result = await processCheckoutCompleted(fakeAdmin(state), "acct_1", session, d);
  assert.deepEqual(result, { status: "recorded", amount: 1130, overpaid: 0, receiptSent: true, excessRefunded: false });
  const row = state.inserted[0];
  assert.equal(row.document_id, "doc1");
  assert.equal(row.amount, 1130, "the HST sales figures use the gross amount, not the net");
  assert.equal(row.paid_date, "2026-10-20");
  assert.equal(row.method, "Card (online)");
  assert.equal(row.source, "stripe");
  assert.equal(row.stripe_payment_intent_id, "pi_1");
  assert.equal(row.stripe_fee, 33.07);
  assert.equal(row.stripe_net, 1096.93);
  assert.equal(state.docUpdates.at(-1)?.status, "paid");
  assert.equal(receipts.length, 1);
});

test("the receipt has what the client knows - and nothing else", async () => {
  const state = makeState();
  const { d, receipts } = deps();
  await processCheckoutCompleted(fakeAdmin(state), "acct_1", session, d);
  const r = receipts[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(r).sort(), [
    "amountPaid",
    "balanceRemaining",
    "brandFooter",
    "businessName",
    "clientName",
    "documentNumber",
    "to",
    "viewToken",
  ]);
  assert.equal(r.to, "ana@example.com");
  assert.equal(r.balanceRemaining, 0);
  assert.equal(r.brandFooter, true, "a Free account's invoice emails carry the credit");
});

test("a Pro owner's receipt has no TaxSnap credit", async () => {
  const state = makeState({ profile: { stripe_connect_account_id: "acct_1", business_name: "R", subscription_status: "pro" } });
  const { d, receipts } = deps();
  await processCheckoutCompleted(fakeAdmin(state), "acct_1", session, d);
  assert.equal((receipts[0] as { brandFooter: boolean }).brandFooter, false);
});

test("a replayed event records nothing twice and sends no second receipt, but still heals the status", async () => {
  const state = makeState();
  const { d, receipts } = deps();
  await processCheckoutCompleted(fakeAdmin(state), "acct_1", session, d);
  const again = await processCheckoutCompleted(fakeAdmin(state), "acct_1", session, d);
  assert.deepEqual(again, { status: "duplicate" });
  assert.equal(state.inserted.length, 1);
  assert.equal(receipts.length, 1);
  assert.equal(state.docUpdates.length, 2, "status was recomputed on the replay");
  assert.equal(state.docUpdates.at(-1)?.status, "paid");
});

test("a partly paid invoice records only what was paid and keeps a partial status", async () => {
  const state = makeState();
  state.doc.payments.push({ amount: 500, stripe_payment_intent_id: null });
  const { d } = deps();
  const result = await processCheckoutCompleted(fakeAdmin(state), "acct_1", { ...session, amount_total: 63000 }, d);
  assert.equal(result.status, "recorded");
  assert.equal(state.inserted[0].amount, 630);
  assert.equal(state.docUpdates.at(-1)?.status, "paid");
});

test("a second payment on an already covered invoice is flagged, not recorded", async () => {
  const state = makeState();
  state.doc.payments.push({ amount: 1130, source: "stripe", stripe_payment_intent_id: "pi_first" });
  const { d, receipts, refunds } = deps();
  const result = await processCheckoutCompleted(fakeAdmin(state), "acct_1", session, d);
  assert.deepEqual(result, { status: "skipped", overpaid: 1130, excessRefunded: true });
  assert.equal(state.inserted.length, 0, "nothing recorded");
  assert.equal(receipts.length, 0);
  assert.equal(refunds.length, 1, "the whole second payment is refunded automatically");
});

test("an event from the wrong connected account, or for an unknown invoice, is ignored", async () => {
  const { d } = deps();
  const wrongAccount = makeState();
  assert.deepEqual(await processCheckoutCompleted(fakeAdmin(wrongAccount), "acct_other", session, d), {
    status: "ignored",
    reason: "account_mismatch",
  });
  assert.equal(wrongAccount.inserted.length, 0);

  const noAccount = makeState();
  assert.deepEqual(await processCheckoutCompleted(fakeAdmin(noAccount), null, session, d), {
    status: "ignored",
    reason: "no_connected_account",
  });

  const missing = makeState();
  (missing as { doc: unknown }).doc = null;
  assert.deepEqual(await processCheckoutCompleted(fakeAdmin(missing), "acct_1", session, d), {
    status: "ignored",
    reason: "unknown_invoice",
  });

  const estimate = makeState();
  estimate.doc.type = "estimate";
  assert.equal((await processCheckoutCompleted(fakeAdmin(estimate), "acct_1", session, d)).status, "ignored");

  const unpaid = makeState();
  assert.equal(
    (await processCheckoutCompleted(fakeAdmin(unpaid), "acct_1", { ...session, payment_status: "unpaid" }, d)).status,
    "ignored",
  );
});

test("a session that is not paid yet (delayed payment method) records nothing", async () => {
  for (const payment_status of ["unpaid", "no_payment_required"]) {
    const state = makeState();
    const { d } = deps();
    const res = await processCheckoutCompleted(fakeAdmin(state), "acct_1", { ...session, payment_status }, d);
    assert.equal(res.status, "ignored", payment_status);
    assert.equal(state.inserted.length, 0, `${payment_status}: no payment row`);
    assert.equal(state.overpayments.length, 0, `${payment_status}: no overpayment row`);
  }
});

test("the Connect Checkout Session is card only: payment_method_types is exactly ['card']", () => {
  const src = read("../app/api/public/invoice/[token]/checkout/route.ts");
  assert.match(src, /payment_method_types: \["card"\]/);
  assert.equal((src.match(/payment_method_types/g) ?? []).length, 1);
  // The only Checkout Session created on a connected account is this route's.
  const create = src.slice(src.indexOf("checkout.sessions.create("));
  assert.ok(create.indexOf('payment_method_types: ["card"]') < create.indexOf("stripeAccount:"), "set in the session params");
  assert.doesNotMatch(src, /affirm|klarna|link|afterpay|us_bank_account|acss_debit/i);
});

test("a failed fee lookup or a failed receipt never blocks the payment", async () => {
  const state = makeState();
  const { d } = deps({
    fetchFee: async () => {
      throw new Error("stripe down");
    },
    sendReceipt: async () => {
      throw new Error("resend down");
    },
  });
  const result = await processCheckoutCompleted(fakeAdmin(state), "acct_1", session, d);
  assert.deepEqual(result, { status: "recorded", amount: 1130, overpaid: 0, receiptSent: false, excessRefunded: false });
  assert.equal(state.inserted[0].stripe_fee ?? null, null, "no fee stored, and the error was logged, not swallowed");
});

test("a client with no email gets no receipt but the payment is recorded", async () => {
  const state = makeState();
  state.doc.client = { name: "Ana", email: null };
  const { d, receipts } = deps();
  const result = await processCheckoutCompleted(fakeAdmin(state), "acct_1", session, d);
  assert.equal(result.status, "recorded");
  assert.equal(receipts.length, 0);
});

// ------------------------------------------------------------------ events and idempotency

test("an event id is claimed once: new, then retry while unfinished, then duplicate once processed", async () => {
  const state = makeState();
  const admin = fakeAdmin(state);
  assert.equal(await claimEvent(admin, { id: "evt_1", type: "account.updated", account: "acct_1" }), "new");
  assert.equal(await claimEvent(admin, { id: "evt_1", type: "account.updated", account: "acct_1" }), "retry");
  state.events.set("evt_1", { processed_at: "2026-10-20T00:00:00Z" });
  assert.equal(await claimEvent(admin, { id: "evt_1", type: "account.updated", account: "acct_1" }), "duplicate");
});

test("account.updated re-reads the account and stores its real status", async () => {
  const state = makeState();
  const { d } = deps();
  await handleConnectEvent(
    fakeAdmin(state),
    { type: "account.updated", account: "acct_1", data: { object: { id: "acct_1", details_submitted: false } } },
    {
      ...d,
      retrieveAccount: async (id) => ({ id, details_submitted: true, charges_enabled: true, payouts_enabled: true, country: "CA" }),
    },
  );
  assert.equal(state.profileUpdates[0].stripe_connect_status, "active");
  assert.equal(state.profileUpdates[0].stripe_connect_charges_enabled, true);
});

test("account.updated falls back to the payload when Stripe can not be read", async () => {
  const state = makeState();
  const { d } = deps();
  await handleConnectEvent(
    fakeAdmin(state),
    { type: "account.updated", account: "acct_1", data: { object: { id: "acct_1", details_submitted: true, charges_enabled: false, country: "CA" } } },
    {
      ...d,
      retrieveAccount: async () => {
        throw new Error("no access");
      },
    },
  );
  assert.equal(state.profileUpdates[0].stripe_connect_status, "restricted");
  assert.equal(state.profileUpdates[0].stripe_connect_charges_enabled, false);
});

test("account.updated for an account we do not know changes nothing and does not fail", async () => {
  const state = makeState({ profileMatches: false });
  const { d } = deps();
  const note = await handleConnectEvent(
    fakeAdmin(state),
    { type: "account.updated", account: "acct_x", data: { object: { id: "acct_x" } } },
    { ...d, retrieveAccount: async (id) => ({ id, details_submitted: true, charges_enabled: true }) },
  );
  assert.equal(note, null);
});

test("account.application.deauthorized disconnects the account and turns Pay now off", async () => {
  const state = makeState();
  const { d } = deps();
  await handleConnectEvent(
    fakeAdmin(state),
    { type: "account.application.deauthorized", account: "acct_1", data: { object: {} } },
    d,
  );
  assert.equal(state.profileUpdates[0].stripe_connect_status, "disconnected");
  assert.equal(state.profileUpdates[0].stripe_connect_charges_enabled, false);
  assert.equal(state.profileUpdates[0].stripe_connect_payouts_enabled, false);
});

test("checkout.session.completed returns an overpaid note once the excess is refunded; other events are not handled", async () => {
  const state = makeState();
  state.doc.payments.push({ amount: 1130, source: "stripe", stripe_payment_intent_id: "pi_first" });
  const { d } = deps();
  const event = { type: "checkout.session.completed", account: "acct_1", data: { object: session as unknown as Record<string, unknown> } };
  const note = await handleConnectEvent(fakeAdmin(state), event, d);
  assert.equal(note, "overpaid:1130.00:refunded");
  const other = await handleConnectEvent(
    fakeAdmin(makeState()),
    { type: "customer.created", account: "acct_1", data: { object: {} } },
    d,
  );
  assert.equal(other, null);
});

// ------------------------------------------------------------------ rate limiting (fake attempts table)

function fakeAttempts(counts: { token: number; ip: number }) {
  const inserted: Record<string, unknown>[] = [];
  return {
    inserted,
    admin: {
      from() {
        return {
          insert: async (row: Record<string, unknown>) => {
            inserted.push(row);
            return { error: null };
          },
          select: () => ({
            eq: (col: string) => ({
              gte: async () => ({ count: col === "token_hash" ? counts.token : counts.ip }),
            }),
          }),
          delete: () => ({ lt: async () => ({ error: null }) }),
        };
      },
    } as never,
  };
}

test("Pay now clicks are recorded hashed, and limited past the threshold", async () => {
  const now = new Date("2026-10-20T15:00:00Z");
  const fine = fakeAttempts({ token: 2, ip: 2 });
  assert.deepEqual(await recordCheckoutAttempt(fine.admin, { token: "th", ip: "ih" }, now), { limited: false });
  assert.deepEqual(fine.inserted[0], { token_hash: "th", ip_hash: "ih" });
  assert.equal((await recordCheckoutAttempt(fakeAttempts({ token: 6, ip: 1 }).admin, { token: "a", ip: "b" }, now)).limited, true);
  assert.equal((await recordCheckoutAttempt(fakeAttempts({ token: 1, ip: 21 }).admin, { token: "a", ip: "b" }, now)).limited, true);
});

// ------------------------------------------------------------------ edit / delete / draft locks

test("a Stripe payment can not be edited or deleted; a manual one can", async () => {
  const db = (source: string | null) =>
    ({
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: source ? { source } : null }) }) }),
        }),
      }),
    }) as never;
  assert.match((await stripePaymentLockMessage(db("stripe"), "d", "p")) ?? "", /made online by card/);
  assert.ok(await stripePaymentLockMessage(db("stripe_refund"), "d", "p"));
  assert.equal(await stripePaymentLockMessage(db("manual"), "d", "p"), null);
  assert.equal(await stripePaymentLockMessage(db(null), "d", "p"), null);
  const route = read("../app/api/documents/[id]/payments/[paymentId]/route.ts");
  assert.equal((route.match(/stripePaymentLockMessage\(/g) ?? []).length, 2, "both PATCH and DELETE");
  assert.match(read("../components/invoices/document-detail.tsx"), /payment\.source === "manual"/);
});

test("an invoice with a live payment link can not go back to draft", () => {
  const opened = { status: "sent", online_session_opened_at: "2026-10-20T00:00:00Z" };
  assert.equal(draftBlockedMessage("draft", opened), DRAFT_AFTER_SESSION_MESSAGE);
  assert.equal(draftBlockedMessage("sent", opened), null);
  assert.equal(draftBlockedMessage(undefined, opened), null);
  assert.equal(draftBlockedMessage("draft", { status: "sent", online_session_opened_at: null }), null);
  assert.equal(draftBlockedMessage("draft", { status: "draft", online_session_opened_at: null }), null);
  assert.match(read("../app/api/documents/[id]/route.ts"), /draftBlockedMessage\(body\?\.status, existing\)/);
});

// ------------------------------------------------------------------ routes and pages

test("the checkout route never reads an amount (or anything) from the browser", () => {
  const src = read("../app/api/public/invoice/[token]/checkout/route.ts");
  assert.doesNotMatch(src, /request\.(json|formData|text)\(/);
  assert.match(src, /onlinePayableAmount\(/);
  assert.match(src, /toCents\(amount\)/);
  assert.match(src, /idempotencyKey/);
  assert.match(src, /stripeAccount: profile\.stripe_connect_account_id/);
  assert.match(src, /recordCheckoutAttempt\(/);
  assert.doesNotMatch(src, /application_fee/, "no TaxSnap platform fee");
  assert.doesNotMatch(src, /automatic_tax/, "HST is already in the amount");
});

test("the checkout route gives one answer for every reason an invoice can not be paid", () => {
  const src = read("../app/api/public/invoice/[token]/checkout/route.ts");
  assert.equal((src.match(/return notPayable\(\)/g) ?? []).length, 3);
  assert.match(src, /NOT_PAYABLE_MESSAGE/);
  assert.ok(src.indexOf("recordCheckoutAttempt(") < src.indexOf('.eq("view_token", token)'), "rate limit before the lookup");
});

test("nothing private goes to Stripe: no notes, no line items, no client address", () => {
  const src = read("../app/api/public/invoice/[token]/checkout/route.ts");
  assert.doesNotMatch(src, new RegExp(["internal", "notes"].join("_")));
  assert.doesNotMatch(src, /document_items|bitems:|notes/);
  assert.doesNotMatch(src, /is_sample/);
  const email = read("./email.ts");
  const receipt = email.slice(email.indexOf("export async function sendPaymentReceiptEmail"));
  assert.doesNotMatch(receipt, new RegExp(["internal", "notes"].join("_")));
});

test("the webhook verifies the signature, the key mode and idempotency before handling anything", () => {
  const src = read("../app/api/stripe/connect-webhook/route.ts");
  assert.match(src, /constructEvent\(body, signature, secret\)/);
  assert.match(src, /STRIPE_CONNECT_WEBHOOK_SECRET/);
  assert.match(src, /eventMatchesKeyMode\(/);
  assert.ok(src.indexOf("constructEvent") < src.indexOf("claimEvent("));
  assert.ok(src.indexOf("claimEvent(") < src.indexOf("handleConnectEvent("));
  assert.match(src, /status: 500/, "a failed event stays unprocessed so Stripe retries it");
  assert.match(src, /status: 400/);
});

test("the subscription webhook is untouched and never sees Connect events", () => {
  const src = read("../app/api/stripe/webhook/route.ts");
  assert.doesNotMatch(src, /checkout\.session\.completed[\s\S]*payments/);
  assert.doesNotMatch(src, /connect/i);
});

test("the public page shows Pay now only through the same rule the route enforces", () => {
  const page = read("../app/invoice/[token]/page.tsx");
  assert.match(page, /onlinePayableAmount\(/);
  assert.match(page, /payable !== null && \(/);
  assert.match(page, /stripe_connect_charges_enabled/);
  assert.match(read("../components/public/pay-now-button.tsx"), /checkout/);
  assert.doesNotMatch(read("../components/public/pay-now-button.tsx"), /amount:|JSON\.stringify/);
});

test("Settings shows the Online payments card to general accounts", () => {
  const page = read("../app/(app)/dashboard/settings/page.tsx");
  assert.match(page, /<OnlinePaymentsCard/);
  assert.match(page, /stripe_connect_status/);
  const card = read("../components/settings/online-payments-card.tsx");
  assert.match(card, /\/api\/stripe\/connect\/start/);
  assert.match(card, /ONLINE_PAYMENTS_DISCLOSURE_SHORT/, "the fee and dispute wording comes from the shared disclosure");
  assert.match(read("./online-payments-terms.ts"), /domesticCard: "2\.9% \+ CA\$0\.30"/);
});

test("onboarding uses the full-dashboard, Stripe-covers-losses configuration, Canada only", () => {
  const params = connectedAccountParams({ userId: "u1", email: "o@example.com", businessName: "Rivera Painting" });
  assert.deepEqual(params.controller, {
    stripe_dashboard: { type: "full" },
    requirement_collection: "stripe",
    fees: { payer: "account" },
    losses: { payments: "stripe" },
  });
  assert.equal(params.country, "CA");
  const src = read("./stripe-connect.ts");
  assert.match(src, /connectedAccountParams\(input\)/);
  assert.match(src, /type: "account_onboarding"/);
  assert.match(src, /\/api\/stripe\/connect\/refresh/);
  assert.match(src, /\/api\/stripe\/connect\/return/);
});

test("0067 adds the columns the code uses, locks the two private tables, and has a rollback", () => {
  const up = read("../../supabase/migrations/0067_online_payments_connect.sql");
  for (const col of [
    "stripe_connect_account_id",
    "stripe_connect_status",
    "stripe_connect_charges_enabled",
    "requested_payment_amount",
    "online_session_opened_at",
    "stripe_payment_intent_id",
    "stripe_fee",
    "stripe_net",
  ]) {
    assert.match(up, new RegExp(col), col);
  }
  assert.match(up, /payments_stripe_pi_source_uniq/);
  assert.match(up, /'not_connected','incomplete','restricted','active','disconnected'/);
  assert.match(up, /stripe_events[\s\S]*enable row level security/);
  assert.match(up, /checkout_attempts[\s\S]*enable row level security/);
  assert.doesNotMatch(up, /create policy/i, "the two tables are service role only");
  const down = read("../../supabase/rollbacks/0067_online_payments_connect_rollback.sql");
  assert.match(down, /drop table if exists public\.stripe_events/);
  assert.match(down, /drop column if exists stripe_connect_account_id/);
});

test("a Stripe payment feeds revenue and HST exactly like a manual one (same table, same math)", () => {
  const revenue = read("./payment-revenue.ts");
  assert.doesNotMatch(revenue, /stripe|source/i, "recognizePayments does not care how a payment arrived");
  const src = read("./online-payments.ts");
  assert.match(src, /statusFromPaid\(totalPaid, doc\.total_amount\)/);
  assert.match(src, /amount: plan\.amount,/);
  assert.doesNotMatch(src, /stripe_fee[^,\n]*amount|amount[^,\n]*stripe_net/);
});

test("the example env file documents the Connect webhook secret", () => {
  assert.match(read("../../.env.local.example"), /STRIPE_CONNECT_WEBHOOK_SECRET/);
});

// ------------------------------------------------------------------ capabilities (card_payments needs transfers)

test("both capabilities are requested at account creation, nothing else", () => {
  const { capabilities } = connectedAccountParams({ userId: "u1", email: null, businessName: null });
  assert.deepEqual(capabilities, { card_payments: { requested: true }, transfers: { requested: true } });
});

test("the connected account is prefilled with the business name AND a product description", () => {
  const withName = connectedAccountParams({ userId: "u1", email: "o@example.com", businessName: "Rivera Painting" });
  assert.deepEqual(withName.business_profile, {
    name: "Rivera Painting",
    product_description: "Contracting and trade services, invoiced through TaxSnap",
  });
  assert.equal(CONNECT_PRODUCT_DESCRIPTION, withName.business_profile.product_description);
  // A contractor who never named the business still gets the description.
  const noName = connectedAccountParams({ userId: "u1", email: null, businessName: null });
  assert.deepEqual(noName.business_profile, { product_description: CONNECT_PRODUCT_DESCRIPTION });
  assert.equal("email" in noName, false);
  assert.equal(withName.email, "o@example.com");
  assert.deepEqual(withName.metadata, { taxsnap_user_id: "u1" });
  // No website is invented.
  assert.equal("url" in withName.business_profile, false);
});

test("an account is active only with charges enabled AND an active card_payments capability", () => {
  const base = { details_submitted: true, charges_enabled: true, country: "CA" };
  assert.equal(connectStatusFromAccount({ ...base, capabilities: { card_payments: "active", transfers: "active" } }), "active");
  // Transfers still being verified, charges already on: Pay now only needs charges, so it stays active.
  assert.equal(connectStatusFromAccount({ ...base, capabilities: { card_payments: "active", transfers: "pending" } }), "active");
  // card_payments not active is never "active", even if charges_enabled says true.
  assert.equal(connectStatusFromAccount({ ...base, capabilities: { card_payments: "pending", transfers: "pending" } }), "restricted");
  assert.equal(connectStatusFromAccount({ ...base, capabilities: { card_payments: "inactive", transfers: "active" } }), "restricted");
  // charges_enabled false is restricted whatever the capabilities say.
  assert.equal(
    connectStatusFromAccount({ ...base, charges_enabled: false, capabilities: { card_payments: "active", transfers: "active" } }),
    "restricted",
  );
  // No capability info (older payloads) falls back to charges_enabled alone.
  assert.equal(connectStatusFromAccount({ ...base, capabilities: null }), "active");
  assert.equal(connectStatusFromAccount(base), "active");
});

test("Pay now follows the stored columns: pending capabilities keep charges_enabled false", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const pending = connectColumns(
    { details_submitted: true, charges_enabled: true, country: "CA", capabilities: { card_payments: "pending", transfers: "pending" } },
    now,
  );
  assert.equal(pending.stripe_connect_status, "restricted");
  assert.equal(pending.stripe_connect_charges_enabled, false);
  const ready = connectColumns(
    { details_submitted: true, charges_enabled: true, payouts_enabled: true, country: "CA", capabilities: { card_payments: "active", transfers: "active" } },
    now,
  );
  assert.equal(ready.stripe_connect_charges_enabled, true);
  // ...and the stored flag is what the Pay now rule reads.
  assert.equal(
    onlinePayableAmount({ type: "invoice", status: "sent", total: 100, paid: 0, connectStatus: pending.stripe_connect_status, chargesEnabled: pending.stripe_connect_charges_enabled, hasAccount: true, disputed: false }),
    null,
  );
  assert.equal(
    onlinePayableAmount({ type: "invoice", status: "sent", total: 100, paid: 0, connectStatus: ready.stripe_connect_status, chargesEnabled: ready.stripe_connect_charges_enabled, hasAccount: true, disputed: false }),
    100,
  );
});

test("account.updated with a pending capability turns Pay now off until it is active", async () => {
  const state = makeState();
  const { d } = deps();
  await handleConnectEvent(
    fakeAdmin(state),
    { type: "account.updated", account: "acct_1", data: { object: { id: "acct_1" } } },
    {
      ...d,
      retrieveAccount: async (id) => ({
        id,
        details_submitted: true,
        charges_enabled: true,
        country: "CA",
        capabilities: { card_payments: "pending", transfers: "pending" },
      }),
    },
  );
  assert.equal(state.profileUpdates[0].stripe_connect_status, "restricted");
  assert.equal(state.profileUpdates[0].stripe_connect_charges_enabled, false);
});

// ------------------------------------------------------------------ sharing marks an invoice Sent

interface Recorded {
  table: string;
  patch: Record<string, unknown>;
  filters: [string, unknown][];
}

function fakeSharing(opts: { rows: { id: string }[]; error?: string }) {
  const calls: Recorded[] = [];
  const db = {
    from(table: string) {
      return {
        update(patch: Record<string, unknown>) {
          const call: Recorded = { table, patch, filters: [] };
          calls.push(call);
          const chain = {
            eq(col: string, val: unknown) {
              call.filters.push([col, val]);
              return chain;
            },
            is(col: string, val: unknown) {
              call.filters.push([col, val]);
              return Promise.resolve({ error: null });
            },
            select: async () => ({ data: opts.error ? null : opts.rows, error: opts.error ? { message: opts.error } : null }),
          };
          return chain;
        },
      };
    },
  } as never;
  return { db, calls };
}

test("sharing a DRAFT invoice moves it to Sent, and says so", async () => {
  const { db, calls } = fakeSharing({ rows: [{ id: "d1" }] });
  assert.deepEqual(await markInvoiceShared(db, "u1", { id: "d1", type: "invoice" }), { markedSent: true });
  const statusWrite = calls.find((c) => c.table === "documents");
  assert.equal(statusWrite?.patch.status, "sent");
  // The guard is IN the query: only a draft, only this owner's, only an invoice.
  assert.deepEqual(statusWrite?.filters, [
    ["id", "d1"],
    ["user_id", "u1"],
    ["type", "invoice"],
    ["status", "draft"],
  ]);
  // The first-invoice-sent activation timestamp is recorded as well.
  assert.ok(calls.some((c) => c.table === "profiles" && "first_invoice_sent_at" in c.patch));
});

test("Sent, Partial and Paid are never downgraded or rewritten: no row matches, nothing changes", async () => {
  const { db, calls } = fakeSharing({ rows: [] });
  assert.deepEqual(await markInvoiceShared(db, "u1", { id: "d1", type: "invoice" }), { markedSent: false });
  const statusWrite = calls.find((c) => c.table === "documents");
  assert.ok(statusWrite?.filters.some(([c, v]) => c === "status" && v === "draft"));
  assert.equal(statusWrite?.patch.status, "sent", "the only value it can ever write");
});

test("an estimate is never touched by sharing", async () => {
  const { db, calls } = fakeSharing({ rows: [{ id: "d1" }] });
  assert.deepEqual(await markInvoiceShared(db, "u1", { id: "d1", type: "estimate" }), { markedSent: false });
  assert.equal(calls.length, 0);
});

test("a failed status update is reported as not changed, never thrown", async () => {
  const { db } = fakeSharing({ rows: [], error: "db down" });
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await markInvoiceShared(db, "u1", { id: "d1", type: "invoice" }), { markedSent: false });
  } finally {
    console.error = original;
  }
});

test("every share route uses the one helper and writes nothing itself", () => {
  for (const f of [
    "../app/api/documents/[id]/share-link/route.ts",
    "../app/api/documents/[id]/send-email/route.ts",
    "../app/api/documents/[id]/mark-sent/route.ts",
  ]) {
    const src = read(f);
    assert.match(src, /markInvoiceShared\(/, f);
    assert.doesNotMatch(src, /\.update\(|\.insert\(|\.delete\(/, `${f} writes only through the helper`);
    assert.match(src, /marked_sent/, `${f} tells the browser`);
  }
  // Estimates: the share-link route returns the signature link before it ever reaches the helper.
  const link = read("../app/api/documents/[id]/share-link/route.ts");
  assert.ok(link.indexOf('doc.type === "estimate"') < link.indexOf("markInvoiceShared("));
  assert.match(read("./mark-invoice-sent.ts"), /\.eq\("status", "draft"\)/);
});

test("the owner is told Invoice marked as Sent for the share sheet, copy link and email", () => {
  const menu = read("../components/invoices/send-document-menu.tsx");
  const button = read("../components/invoices/share-document-button.tsx");
  assert.match(button, /MARKED_SENT_MESSAGE = "Invoice marked as Sent"/);
  assert.equal((menu.match(/announceMarkedSent\(\)/g) ?? []).length, 4, "defined once, used for link, email and share");
  assert.match(menu, /if \(data\.marked_sent\) announceMarkedSent\(\)/);
  assert.match(menu, /reportDocumentSent\(document\.id, true\)/);
  assert.match(button, /reportDocumentSent\(document\.id, true\)/);
  assert.match(button, /router\.refresh\(\)/);
  // A plain download is not a send.
  assert.match(menu, /downloadBlob[\s\S]{0,160}reportDocumentSent\(document\.id\);/);
  assert.match(button, /downloadBlob\(`\$\{shortId\}\.pdf`, pdfBlob\);\s*reportDocumentSent\(document\.id\);/);
});

test("the payment-link rule still holds: a sent invoice with an opened session can not return to draft", () => {
  const opened = { status: "sent", online_session_opened_at: "2026-10-20T00:00:00Z" };
  assert.equal(draftBlockedMessage("draft", opened), DRAFT_AFTER_SESSION_MESSAGE);
  assert.match(read("../app/api/documents/[id]/route.ts"), /draftBlockedMessage\(body\?\.status, existing\)/);
});

// ------------------------------------------------------------------ receipt email fallback

test("receipt recipient: the client email on file wins; the Checkout email only fills a gap", () => {
  assert.deepEqual(receiptRecipient("ana@example.com", "payer@example.com"), { to: "ana@example.com", source: "client" });
  assert.deepEqual(receiptRecipient(" ana@example.com ", null), { to: "ana@example.com", source: "client" });
  assert.deepEqual(receiptRecipient(null, "payer@example.com"), { to: "payer@example.com", source: "checkout" });
  assert.deepEqual(receiptRecipient("", " payer@example.com "), { to: "payer@example.com", source: "checkout" });
  assert.deepEqual(receiptRecipient("   ", "payer@example.com"), { to: "payer@example.com", source: "checkout" });
  assert.equal(receiptRecipient(null, null), null);
  assert.equal(receiptRecipient(undefined, undefined), null);
  assert.equal(receiptRecipient(null, "not-an-email"), null);
  assert.equal(receiptRecipient(null, "a@b"), null);
  assert.equal(receiptRecipient(null, `${"x".repeat(250)}@example.com`), null);
});

function captureWarnings() {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  return { lines, restore: () => (console.warn = original) };
}

test("no client email: the receipt goes to the email entered in Checkout, and the client is not changed", async () => {
  const state = makeState();
  state.doc.client = { name: "Ana", email: null };
  const { d, receipts } = deps();
  // The fake database throws on any table it does not know, so saving the email onto `clients` would fail this test.
  const result = await processCheckoutCompleted(
    fakeAdmin(state),
    "acct_1",
    { ...session, customer_details: { email: "payer@example.com" } },
    d,
  );
  assert.deepEqual(result, { status: "recorded", amount: 1130, overpaid: 0, receiptSent: true, excessRefunded: false });
  assert.equal((receipts[0] as { to: string }).to, "payer@example.com");
  assert.equal(state.inserted.length, 1);
  assert.deepEqual(state.doc.client, { name: "Ana", email: null });
  assert.doesNotMatch(read("./online-payments.ts"), /from\("clients"\)/, "nothing writes the Checkout email onto a client");
});

test("an email on file is still used even when the payer typed another", async () => {
  const state = makeState();
  const { d, receipts } = deps();
  await processCheckoutCompleted(fakeAdmin(state), "acct_1", { ...session, customer_details: { email: "other@example.com" } }, d);
  assert.equal((receipts[0] as { to: string }).to, "ana@example.com");
});

test("no usable email anywhere: payment recorded, receipt skipped, one log line without addresses", async () => {
  const state = makeState();
  state.doc.client = { name: "Ana", email: null };
  const { d, receipts } = deps();
  const warn = captureWarnings();
  let result;
  try {
    result = await processCheckoutCompleted(fakeAdmin(state), "acct_1", { ...session, customer_details: { email: "bad" } }, d);
  } finally {
    warn.restore();
  }
  assert.deepEqual(result, { status: "recorded", amount: 1130, overpaid: 0, receiptSent: false, excessRefunded: false });
  assert.equal(receipts.length, 0);
  assert.equal(warn.lines.length, 1);
  assert.match(warn.lines[0], /^\[receipt\] skipped document=doc1/);
  assert.doesNotMatch(warn.lines[0], /@/);
});

test("a receipt that fails to send logs one line without the address, and the payment stands", async () => {
  const failures: (() => Promise<boolean>)[] = [
    async () => false,
    async () => {
      throw new Error("resend down for payer@example.com");
    },
  ];
  for (const failure of failures) {
    const state = makeState();
    state.doc.client = { name: "Ana", email: null };
    const { d } = deps({ sendReceipt: failure });
    const warn = captureWarnings();
    let result;
    try {
      result = await processCheckoutCompleted(fakeAdmin(state), "acct_1", { ...session, customer_details: { email: "payer@example.com" } }, d);
    } finally {
      warn.restore();
    }
    assert.deepEqual(result, { status: "recorded", amount: 1130, overpaid: 0, receiptSent: false, excessRefunded: false });
    assert.equal(state.inserted.length, 1);
    assert.equal(warn.lines.length, 1);
    assert.match(warn.lines[0], /^\[receipt\] failed document=doc1 \(sent to the checkout email\)$/);
    assert.doesNotMatch(warn.lines[0], /@/);
  }
});

test("a replayed event sends no second receipt and logs nothing", async () => {
  const state = makeState();
  const { d } = deps();
  await processCheckoutCompleted(fakeAdmin(state), "acct_1", session, d);
  const warn = captureWarnings();
  try {
    await processCheckoutCompleted(fakeAdmin(state), "acct_1", session, d);
  } finally {
    warn.restore();
  }
  assert.equal(warn.lines.length, 0);
});
