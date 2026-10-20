import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Row-level security on `payments` (migration 0070): an owner may add, edit and delete only their own
// MANUAL payments. Rows that came from Stripe (card payments, refunds, lost disputes) are service
// role only for update/delete, so a browser holding the anon key can't rewrite the money record
// the webhook wrote. The manual path must keep working exactly as the app uses it
// (POST/PATCH/DELETE /api/documents/[id]/payments), as a REAL signed-in user.
//
// Runs against the REAL project (shared with production), so it is OFF unless
//   RUN_DB_ISOLATION_TEST=1 node --env-file=.env.local --test src/lib/payments-rls-db.test.ts
// It creates throwaway users and always deletes them (their documents and payments cascade).

const RUN = process.env.RUN_DB_ISOLATION_TEST === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = `Pw-${randomUUID()}`;

describe("payments row-level security (real database, signed-in users)", { skip: !RUN || !URL_ || !ANON || !SERVICE }, () => {
  let admin: SupabaseClient;
  const created: string[] = [];
  interface Person {
    id: string;
    client: SupabaseClient;
    documentId: string;
  }

  async function makePerson(label: string): Promise<Person> {
    const email = `payments-rls-${label}-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    const id = data.user!.id;
    created.push(id);
    const client = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
    const { data: doc, error: docError } = await admin
      .from("documents")
      .insert({
        user_id: id,
        type: "invoice",
        status: "sent",
        issue_date: "2026-10-01",
        subtotal: 1000,
        hst_amount: 130,
        total_amount: 1130,
        document_number: 1,
      })
      .select("id")
      .single();
    assert.ifError(docError);
    return { id, client, documentId: doc!.id };
  }

  // A row written the way the webhook writes it: with the service role.
  async function stripeRow(p: Person, source: "stripe" | "stripe_refund" | "stripe_dispute") {
    const refund = source === "stripe_refund" ? { stripe_refund_id: `re_${randomUUID()}` } : {};
    const dispute = source === "stripe_dispute" ? { stripe_dispute_id: `dp_${randomUUID()}` } : {};
    const { data, error } = await admin
      .from("payments")
      .insert({
        document_id: p.documentId,
        amount: source === "stripe" ? 1130 : -100,
        source,
        stripe_payment_intent_id: `pi_${randomUUID()}`,
        ...refund,
        ...dispute,
      })
      .select("id, amount, source")
      .single();
    assert.ifError(error);
    return data!;
  }

  const row = async (id: string) =>
    (await admin.from("payments").select("id, amount, source, method, document_id").eq("id", id).maybeSingle()).data;

  before(() => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
  });

  after(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    if (created.length > 0) {
      const { count } = await admin.from("documents").select("*", { count: "exact", head: true }).in("user_id", created);
      assert.equal(count, 0, "leftover documents");
    }
  });

  it("the app's own manual flow still works: add, edit, delete a manual payment as the owner", async () => {
    const a = await makePerson("manual");
    const { data: added, error } = await a.client
      .from("payments")
      .insert({ document_id: a.documentId, amount: 200, method: "Cash" })
      .select()
      .single();
    assert.ifError(error);
    assert.equal(added!.source, "manual");

    // PATCH /api/documents/[id]/payments/[paymentId]
    const { data: edited, error: editError } = await a.client
      .from("payments")
      .update({ amount: 250, method: "E-transfer", note: "edited" })
      .eq("id", added!.id)
      .eq("document_id", a.documentId)
      .select()
      .single();
    assert.ifError(editError);
    assert.equal(Number(edited!.amount), 250);
    assert.equal(edited!.method, "E-transfer");

    // DELETE /api/documents/[id]/payments/[paymentId]
    const { error: delError } = await a.client.from("payments").delete().eq("id", added!.id).eq("document_id", a.documentId);
    assert.ifError(delError);
    assert.equal(await row(added!.id), null);
  });

  it("an owner can NOT update or delete Stripe rows (card payment, refund, lost dispute); the rows are untouched", async () => {
    const a = await makePerson("stripe");
    for (const source of ["stripe", "stripe_refund", "stripe_dispute"] as const) {
      const r = await stripeRow(a, source);
      const upd = await a.client.from("payments").update({ amount: 1 }).eq("id", r.id).select();
      assert.equal((upd.data ?? []).length, 0, `${source}: update touched nothing`);
      const del = await a.client.from("payments").delete().eq("id", r.id).select();
      assert.equal((del.data ?? []).length, 0, `${source}: delete touched nothing`);
      const kept = await row(r.id);
      assert.ok(kept, `${source}: still there`);
      assert.equal(Number(kept.amount), Number(r.amount));
      assert.equal(kept.source, source);
      // the owner still SEES it (the invoice's payment history)
      const seen = await a.client.from("payments").select("id").eq("id", r.id);
      assert.equal((seen.data ?? []).length, 1, `${source}: readable by the owner`);
    }
  });

  it("an owner can NOT insert a stripe, stripe_refund or stripe_dispute row, even on their own invoice", async () => {
    const a = await makePerson("insert");
    const b = await makePerson("insert-other");
    const attempts = [
      { source: "stripe", amount: 500, stripe_payment_intent_id: `pi_${randomUUID()}` },
      { source: "stripe_refund", amount: -50, stripe_refund_id: `re_${randomUUID()}` },
      { source: "stripe_dispute", amount: -50, stripe_dispute_id: `dp_${randomUUID()}` },
    ];
    for (const extra of attempts) {
      const res = await a.client.from("payments").insert({ document_id: a.documentId, ...extra }).select();
      assert.ok(res.error, `${extra.source}: refused`);
      assert.equal((res.data ?? []).length, 0);
    }
    // naming 'manual' explicitly is fine, the default is fine, and someone else's invoice is not
    assert.ifError((await a.client.from("payments").insert({ document_id: a.documentId, amount: 10, source: "manual" })).error);
    assert.ifError((await a.client.from("payments").insert({ document_id: a.documentId, amount: 11 })).error);
    assert.ok((await a.client.from("payments").insert({ document_id: b.documentId, amount: 12 })).error, "not onto another owner's invoice");
    const { data: rows } = await admin.from("payments").select("source, amount").in("document_id", [a.documentId, b.documentId]);
    assert.deepEqual((rows ?? []).map((r) => r.source), ["manual", "manual"], "only the two allowed manual rows exist");
  });

  it("an owner can not turn their manual payment into a Stripe one, or move it to someone else's invoice", async () => {
    const a = await makePerson("flip-a");
    const b = await makePerson("flip-b");
    const { data: mine } = await a.client.from("payments").insert({ document_id: a.documentId, amount: 50 }).select().single();
    const flip = await a.client.from("payments").update({ source: "stripe" }).eq("id", mine!.id).select();
    assert.ok(flip.error || (flip.data ?? []).length === 0, "source can not be changed");
    const move = await a.client.from("payments").update({ document_id: b.documentId }).eq("id", mine!.id).select();
    assert.ok(move.error || (move.data ?? []).length === 0, "can not be moved to another owner's invoice");
    const now = await row(mine!.id);
    assert.equal(now!.source, "manual");
    assert.equal(now!.document_id, a.documentId);
  });

  it("another owner can touch neither a manual nor a Stripe payment of this one", async () => {
    const a = await makePerson("iso-a");
    const b = await makePerson("iso-b");
    const { data: manual } = await a.client.from("payments").insert({ document_id: a.documentId, amount: 75 }).select().single();
    const card = await stripeRow(a, "stripe");
    for (const id of [manual!.id, card.id]) {
      assert.equal(((await b.client.from("payments").update({ amount: 1 }).eq("id", id).select()).data ?? []).length, 0);
      assert.equal(((await b.client.from("payments").delete().eq("id", id).select()).data ?? []).length, 0);
      assert.equal(((await b.client.from("payments").select("id").eq("id", id)).data ?? []).length, 0, "not even readable");
    }
    assert.ok(await row(manual!.id));
    assert.ok(await row(card.id));
  });

  it("the service role (the webhook) can still change and remove Stripe rows", async () => {
    const a = await makePerson("service");
    const r = await stripeRow(a, "stripe_refund");
    assert.ifError((await admin.from("payments").update({ method: "Refund (card)" }).eq("id", r.id)).error);
    assert.equal((await row(r.id))!.method, "Refund (card)");
    assert.ifError((await admin.from("payments").delete().eq("id", r.id)).error);
    assert.equal(await row(r.id), null);
  });
});
