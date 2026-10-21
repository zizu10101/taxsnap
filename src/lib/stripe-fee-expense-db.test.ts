import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { recordStripeFeeExpense } from "./stripe-fee-expense.ts";
import { syncDispute, type DisputeLike } from "./online-refunds.ts";

// record_stripe_fee_expense() and the origin guard of migration 0071, against the REAL database:
// one fee expense per payment / dispute (and never again after the owner deletes it), the dollars
// that land in `receipts`, and what a signed-in browser may and may not do with the Stripe columns.
//
// Runs against the REAL project (shared with production) with 0071 applied, so it is OFF unless
//   RUN_DB_ISOLATION_TEST=1 node --env-file=.env.local --test src/lib/stripe-fee-expense-db.test.ts
// It creates ONE throwaway user (a plus-address, never the demo or a real account) and always
// deletes it in a finally block (its documents, payments, disputes, receipts and categories cascade),
// then checks nothing is left.

const RUN = process.env.RUN_DB_ISOLATION_TEST === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = `Pw-${randomUUID()}`;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("Stripe fee expenses (real database, migration 0071)", { skip: !RUN || !URL_ || !ANON || !SERVICE }, () => {
  let admin: SupabaseClient;
  let userId = "";
  let owner: SupabaseClient;
  let documentId = "";
  let paymentId = "";
  const disputeId = `dp_test_${randomUUID()}`;
  let hasColumn = false;

  const fees = async (filter: Record<string, string>) => {
    let q = admin.from("receipts").select("*").eq("user_id", userId).eq("origin", "stripe");
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
    const { data, error } = await q;
    assert.ifError(error);
    return data!;
  };

  const callFunction = (client: SupabaseClient, over: Record<string, unknown>) =>
    client.rpc("record_stripe_fee_expense", {
      p_user_id: userId,
      p_payment_id: null,
      p_dispute_id: null,
      p_merchant: "Stripe",
      p_date: "2026-10-20",
      p_amount: 33.07,
      p_category: "Bank charges",
      p_items: [{ name: "Stripe fee on INV-1003 (recorded automatically)", amount: 33.07 }],
      ...over,
    });

  before(async () => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
    // Skip everything until 0071 is applied (the column is its marker).
    const probe = await admin.from("profiles").select("record_stripe_fee_expenses").limit(1);
    hasColumn = !probe.error;
    assert.ok(hasColumn, "migration 0071 is not applied to this project: run it first");

    const email = `info+taxsnap-fee-test-${randomUUID()}@edgedbs.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    userId = data.user!.id;
    owner = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    assert.ifError((await owner.auth.signInWithPassword({ email, password })).error);

    const { data: doc, error: docError } = await admin
      .from("documents")
      .insert({ user_id: userId, type: "invoice", status: "paid", issue_date: "2026-10-01", subtotal: 1000, hst_amount: 130, total_amount: 1130, document_number: 1003 })
      .select("id")
      .single();
    assert.ifError(docError);
    documentId = doc!.id;

    const { data: pay, error: payError } = await admin
      .from("payments")
      .insert({ document_id: documentId, amount: 1130, paid_date: "2026-10-20", method: "Card (online)", source: "stripe", stripe_payment_intent_id: `pi_test_${randomUUID()}`, stripe_fee: 33.07, stripe_net: 1096.93 })
      .select("id")
      .single();
    assert.ifError(payError);
    paymentId = pay!.id;

    const { error: connectError } = await admin.from("profiles").update({ stripe_connect_account_id: `acct_test_${randomUUID()}` }).eq("id", userId);
    assert.ifError(connectError);
  });

  after(async () => {
    try {
      if (userId) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        assert.ifError(error);
        for (const table of ["receipts", "documents", "expense_categories"]) {
          const { count } = await admin.from(table).select("*", { count: "exact", head: true }).eq("user_id", userId);
          assert.equal(count, 0, `leftover ${table}`);
        }
        const { count: leftover } = await admin.from("stripe_disputes").select("*", { count: "exact", head: true }).eq("id", disputeId);
        assert.equal(leftover, 0, "leftover dispute");
      }
    } finally {
      if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  });

  it("1. a payment fee creates exactly one expense: origin stripe, tax 0, the category, the right dollars, outcome 'recorded'", async () => {
    const result = await recordStripeFeeExpense(admin as never, {
      userId,
      source: { kind: "payment", id: paymentId },
      fee: 33.07,
      date: "2026-10-20",
      documentNumber: 1003,
    });
    assert.equal(result.status, "created");
    const rows = await fees({ stripe_payment_id: paymentId });
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.equal(r.origin, "stripe");
    assert.equal(Number(r.tax_amount), 0);
    assert.equal(r.tax_rate, null);
    assert.equal(r.tax_category, "Bank charges");
    assert.equal(r.merchant_name, "Stripe");
    assert.equal(Number(r.total_amount), 33.07, "dollars, not cents");
    assert.equal(r.transaction_date, "2026-10-20");
    assert.equal(r.from_statement, false);
    assert.equal(r.no_receipt, false);
    assert.deepEqual(r.items, [{ name: "Stripe fee on INV-1003 (recorded automatically)", amount: 33.07 }]);
    const { data: p } = await admin.from("payments").select("fee_expense_outcome").eq("id", paymentId).single();
    assert.equal(p!.fee_expense_outcome, "recorded");
    const { data: cat } = await admin.from("expense_categories").select("name, system_key").eq("user_id", userId);
    assert.deepEqual(cat, [{ name: "Bank charges", system_key: "bank_charges" }]);
  });

  it("2. calling it again returns null and creates no second row", async () => {
    const { data, error } = await callFunction(admin, { p_payment_id: paymentId });
    assert.ifError(error);
    assert.equal(data, null);
    const again = await recordStripeFeeExpense(admin as never, { userId, source: { kind: "payment", id: paymentId }, fee: 33.07, date: "2026-10-20", documentNumber: 1003 });
    assert.equal(again.status, "already_handled");
    assert.equal((await fees({ stripe_payment_id: paymentId })).length, 1);
  });

  it("3. the owner deletes the expense, and calling again still creates nothing", async () => {
    const [row] = await fees({ stripe_payment_id: paymentId });
    const del = await owner.from("receipts").delete().eq("id", row.id).select();
    assert.ifError(del.error);
    assert.equal((del.data ?? []).length, 1, "an automatic expense is deletable like any other");
    assert.equal((await fees({ stripe_payment_id: paymentId })).length, 0);

    const { data, error } = await callFunction(admin, { p_payment_id: paymentId });
    assert.ifError(error);
    assert.equal(data, null);
    assert.equal((await fees({ stripe_payment_id: paymentId })).length, 0, "not recreated");
    const { data: p } = await admin.from("payments").select("fee_expense_outcome").eq("id", paymentId).single();
    assert.equal(p!.fee_expense_outcome, "recorded", "remembered on the payment row");
  });

  it("4. a dispute fee does the same with stripe_disputes: cents from Stripe become dollars, once, and stay deleted", async () => {
    const dispute: DisputeLike = {
      id: disputeId,
      charge: "ch_test",
      payment_intent: "pi_test_dispute",
      amount: 113000,
      currency: "cad",
      status: "needs_response",
      created: Math.floor(new Date("2026-10-18T10:00:00Z").getTime() / 1000),
      balance_transactions: [{ fee: 1500 }],
    };
    // The ledger lookup needs the original card payment for this payment intent.
    const { error: relinkError } = await admin.from("payments").update({ stripe_payment_intent_id: "pi_test_dispute" }).eq("id", paymentId);
    assert.ifError(relinkError);
    const { data: profile } = await admin.from("profiles").select("stripe_connect_account_id").eq("id", userId).single();
    const account = profile!.stripe_connect_account_id as string;
    const run = () =>
      syncDispute(
        admin as never,
        account,
        { id: disputeId, object: "dispute" },
        { livemode: false, notifyOnOpen: false },
        {
          now: () => new Date("2026-10-20T15:00:00Z"),
          retrieveCharge: async () => ({ id: "ch_test", currency: "cad", payment_intent: "pi_test_dispute", metadata: { document_id: documentId } }),
          retrieveDispute: async () => dispute,
          notifyOwner: async () => true,
          recordFeeExpense: (input) => recordStripeFeeExpense(admin as never, input),
        },
      );
    await run();
    let rows = await fees({ stripe_dispute_id: disputeId });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].origin, "stripe");
    assert.equal(Number(rows[0].total_amount), 15, "1500 cents from Stripe = $15.00");
    assert.equal(Number(rows[0].tax_amount), 0);
    assert.equal(rows[0].tax_category, "Bank charges");
    assert.equal(rows[0].transaction_date, "2026-10-18");
    const { data: d } = await admin.from("stripe_disputes").select("fee, fee_expense_outcome").eq("id", disputeId).single();
    assert.equal(Number(d!.fee), 15);
    assert.equal(d!.fee_expense_outcome, "recorded");

    await run(); // replay
    assert.equal((await fees({ stripe_dispute_id: disputeId })).length, 1);

    const del = await owner.from("receipts").delete().eq("id", rows[0].id).select();
    assert.equal((del.data ?? []).length, 1);
    await run(); // retry after delete
    rows = await fees({ stripe_dispute_id: disputeId });
    assert.equal(rows.length, 0, "not recreated");
    const direct = await callFunction(admin, { p_dispute_id: disputeId, p_amount: 15 });
    assert.ifError(direct.error);
    assert.equal(direct.data, null);
  });

  it("the function refuses a payment or dispute that is not this user's, and bad arguments", async () => {
    const wrongUser = await callFunction(admin, { p_user_id: randomUUID(), p_payment_id: paymentId });
    assert.ok(wrongUser.error, "another user's id is refused");
    const both = await callFunction(admin, { p_payment_id: paymentId, p_dispute_id: disputeId });
    assert.ok(both.error, "exactly one of payment / dispute");
    const neither = await callFunction(admin, {});
    assert.ok(neither.error);
    const zero = await callFunction(admin, { p_payment_id: paymentId, p_amount: 0 });
    assert.ok(zero.error, "a fee must be positive");
  });

  it("5. a signed-in user cannot call the function, cannot create or set origin / Stripe links, but can clear the links", async () => {
    // Needs a fresh payment so there is something to call it for.
    const { data: pay2 } = await admin
      .from("payments")
      .insert({ document_id: documentId, amount: 5, source: "stripe", stripe_payment_intent_id: `pi_test_${randomUUID()}`, stripe_fee: 1.5 })
      .select("id")
      .single();
    const direct = await callFunction(owner, { p_payment_id: pay2!.id, p_amount: 1.5 });
    assert.ok(direct.error, "execute is granted to service_role only");
    assert.equal((await fees({ stripe_payment_id: pay2!.id })).length, 0);
    const { data: untouched } = await admin.from("payments").select("fee_expense_outcome").eq("id", pay2!.id).single();
    assert.equal(untouched!.fee_expense_outcome, null);

    const base = { user_id: userId, merchant_name: "Mine", transaction_date: "2026-10-20", total_amount: 10, tax_amount: 0, tax_category: "Supplies" };
    // insert with origin / links
    assert.ok((await owner.from("receipts").insert({ ...base, origin: "stripe" }).select()).error, "origin on insert");
    assert.ok((await owner.from("receipts").insert({ ...base, origin: "stripe", stripe_payment_id: pay2!.id }).select()).error, "payment link on insert");
    assert.ok((await owner.from("receipts").insert({ ...base, stripe_dispute_id: disputeId }).select()).error, "dispute link on insert");
    // an ordinary insert is fine, and then origin / links cannot be set on it
    const ordinary = await owner.from("receipts").insert(base).select().single();
    assert.ifError(ordinary.error);
    assert.ok((await owner.from("receipts").update({ origin: "stripe" }).eq("id", ordinary.data!.id).select()).error, "origin on update");
    assert.ok((await owner.from("receipts").update({ stripe_payment_id: pay2!.id }).eq("id", ordinary.data!.id).select()).error, "link on update");
    const still = await admin.from("receipts").select("origin, stripe_payment_id, stripe_dispute_id").eq("id", ordinary.data!.id).single();
    assert.deepEqual(still.data, { origin: null, stripe_payment_id: null, stripe_dispute_id: null });
    // the owner can still edit an ordinary expense as usual
    assert.ifError((await owner.from("receipts").update({ merchant_name: "Edited" }).eq("id", ordinary.data!.id).select().single()).error);

    // An automatic expense: editable, its links can be cleared, but not repointed and origin stays.
    const created = await callFunction(admin, { p_payment_id: pay2!.id, p_amount: 1.5, p_items: [] });
    assert.ifError(created.error);
    const id = created.data as string;
    assert.ifError((await owner.from("receipts").update({ merchant_name: "Stripe Inc", total_amount: 1.6 }).eq("id", id).select().single()).error);
    assert.ok((await owner.from("receipts").update({ stripe_payment_id: paymentId }).eq("id", id).select()).error, "cannot repoint the link");
    assert.ok((await owner.from("receipts").update({ origin: null }).eq("id", id).select()).error, "cannot drop the origin");
    const cleared = await owner.from("receipts").update({ stripe_payment_id: null }).eq("id", id).select().single();
    assert.ifError(cleared.error);
    assert.equal(cleared.data!.stripe_payment_id, null);
    assert.equal(cleared.data!.origin, "stripe", "still labelled automatic");
    // clearing the link does not make the fee eligible again
    const again = await callFunction(admin, { p_payment_id: pay2!.id, p_amount: 1.5 });
    assert.equal(again.data, null);
  });

  it("deleting the invoice's payment clears the link but keeps the expense (on delete set null)", async () => {
    const { data: pay3 } = await admin
      .from("payments")
      .insert({ document_id: documentId, amount: 7, source: "stripe", stripe_payment_intent_id: `pi_test_${randomUUID()}`, stripe_fee: 0.5 })
      .select("id")
      .single();
    const made = await callFunction(admin, { p_payment_id: pay3!.id, p_amount: 0.5, p_items: [] });
    assert.ifError(made.error);
    assert.ifError((await admin.from("payments").delete().eq("id", pay3!.id)).error);
    const { data: kept } = await admin.from("receipts").select("origin, stripe_payment_id").eq("id", made.data as string).single();
    assert.deepEqual(kept, { origin: "stripe", stripe_payment_id: null });
  });

  it("6. the Free scan count ignores origin 'stripe' rows", async () => {
    // Same query as POST /api/parse-receipt, as the signed-in owner, over this month.
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const since = start.toISOString();
    const { data: pay4 } = await admin
      .from("payments")
      .insert({ document_id: documentId, amount: 9, source: "stripe", stripe_payment_intent_id: `pi_test_${randomUUID()}`, stripe_fee: 0.9 })
      .select("id")
      .single();
    assert.ifError((await callFunction(admin, { p_payment_id: pay4!.id, p_amount: 0.9, p_items: [] })).error);

    const everything = await owner.from("receipts").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
    const counted = await owner.from("receipts").select("id", { count: "exact", head: true }).eq("user_id", userId).is("origin", null).gte("created_at", since);
    assert.ifError(everything.error);
    assert.ifError(counted.error);
    const stripeRows = (await fees({})).length;
    assert.ok(stripeRows >= 1);
    assert.equal(everything.count! - counted.count!, stripeRows, "exactly the Stripe rows drop out of the count");
    assert.ok(counted.count! >= 1, "the owner's ordinary expense still counts");

    const route = read("../app/api/parse-receipt/route.ts");
    assert.match(route.slice(route.indexOf('.from("receipts")')), /\.is\("origin", null\)/, "the route uses that same filter");
  });

  it("the dollars: the code that turns Stripe's cents into dollars divides by 100 exactly once", () => {
    assert.match(read("./stripe-connect.ts"), /fee: bt\.fee \/ 100, net: bt\.net \/ 100/);
    assert.match(read("./online-refunds.ts"), /fee = fees > 0 \? round2\(fees \/ 100\) : null/);
    assert.doesNotMatch(read("./stripe-fee-expense.ts"), /\/ 100|\* 100/);
  });
});
