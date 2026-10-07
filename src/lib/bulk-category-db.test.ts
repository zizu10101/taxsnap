import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { handleBulkCategory, type BulkResult } from "./bulk-category-server.ts";
import { BULK_CATEGORY_MAX } from "./bulk-category.ts";

// Bulk "Change category" against the real database, as REAL SIGNED-IN USERS - the same client the
// route hands to handleBulkCategory, so row-level security scopes every read and write. A second
// user is the bystander that proves one owner can never touch another's expenses.
//
// Runs against the REAL project (shared with production), so it is OFF unless
//   RUN_DB_ISOLATION_TEST=1 node --env-file=.env.local --test src/lib/bulk-category-db.test.ts
// It creates two throwaway users and always deletes them, verifying nothing is left.

const RUN = process.env.RUN_DB_ISOLATION_TEST === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = `Pw-${randomUUID()}`;

describe("bulk change category (real database, signed-in users)", { skip: !RUN || !URL_ || !ANON || !SERVICE }, () => {
  let admin: SupabaseClient;
  const created: string[] = [];
  interface Person {
    id: string;
    client: SupabaseClient;
  }
  let a: Person;
  let b: Person;

  async function makePerson(label: string): Promise<Person> {
    const email = `bulk-category-${label}-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    created.push(data.user!.id);
    const client = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
    return { id: data.user!.id, client };
  }

  // Saved through the owner's own session, like POST /api/receipts.
  async function save(p: Person, over: Record<string, unknown> = {}) {
    const res = await p.client
      .from("receipts")
      .insert({
        user_id: p.id,
        merchant_name: "Test Vendor",
        transaction_date: "2026-02-08",
        total_amount: 113,
        tax_amount: 13,
        tax_category: "Supplies",
        ...over,
      })
      .select("*")
      .single();
    assert.ifError(res.error);
    return res.data as Record<string, unknown> & { id: string };
  }

  const fetchRow = async (p: Person, id: string) =>
    (await p.client.from("receipts").select("*").eq("id", id).single()).data as Record<string, unknown>;
  const run = (p: Person, body: unknown): Promise<BulkResult> => handleBulkCategory(p.client, p.id, body);
  const preview = async (p: Person, ids: string[], category: string) => {
    const res = await run(p, { mode: "preview", ids, category });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.plan as { changes: { id: string; from: string }[]; will_change: number; meals_involved: boolean; missing: number };
  };

  before(async () => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
    a = await makePerson("a");
    b = await makePerson("b");
  });

  after(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    if (created.length > 0) {
      const { count } = await admin.from("receipts").select("*", { count: "exact", head: true }).in("user_id", created);
      assert.equal(count, 0, "leftover receipts");
      const { count: cats } = await admin.from("expense_categories").select("*", { count: "exact", head: true }).in("user_id", created);
      assert.equal(cats, 0, "leftover categories");
    }
  });

  it("1. apply changes ONLY tax_category: every other column of every row is identical, tax_amount included", async () => {
    const r1 = await save(a, { tax_category: "Supplies", merchant_name: "Home Depot", job_name: "Smith Kitchen" });
    const r2 = await save(a, { tax_category: "Vehicle/Fuel", total_amount: 56.5, tax_amount: 6.5 });
    // A row a card-statement import created: still flagged as one afterwards, tax untouched.
    const r3 = await save(a, { tax_category: "Vehicle/Fuel", from_statement: true, no_receipt: true, tax_amount: 0 });
    const before = [r1, r2, r3].map((r) => ({ ...r }));

    const plan = await preview(a, [r1.id, r2.id, r3.id], "Tools & Equipment");
    assert.equal(plan.will_change, 3);
    const res = await run(a, { mode: "apply", category: "Tools & Equipment", changes: plan.changes });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.changed, 3);

    for (const old of before) {
      const now = await fetchRow(a, old.id);
      assert.equal(now.tax_category, "Tools & Equipment");
      const restBefore: Record<string, unknown> = { ...old };
      const restAfter: Record<string, unknown> = { ...now };
      delete restBefore.tax_category;
      delete restAfter.tax_category;
      assert.deepEqual(restAfter, restBefore, "nothing but tax_category changed");
    }
  });

  it("2. an unknown category is refused - never silently turned into 'Other'", async () => {
    const r = await save(a, { tax_category: "Vehicle/Fuel" });
    for (const mode of ["preview", "apply"]) {
      const res = await run(a, { mode, ids: [r.id], category: "Not A Category", changes: [{ id: r.id, from: "Vehicle/Fuel" }] });
      assert.equal(res.status, 400);
    }
    assert.equal((await fetchRow(a, r.id)).tax_category, "Vehicle/Fuel");
    assert.equal((await run(a, { mode: "preview", ids: [r.id], category: "" })).status, 400);
    assert.equal((await run(a, { mode: "nonsense" })).status, 400);
  });

  it("3. a custom category must be the owner's own and ACTIVE to be a target; another owner's is unknown", async () => {
    const mine = `Mine ${randomUUID().slice(0, 6)}`;
    const old = `Old ${randomUUID().slice(0, 6)}`;
    assert.ifError((await admin.from("expense_categories").insert({ user_id: a.id, name: mine, is_active: true })).error);
    assert.ifError((await admin.from("expense_categories").insert({ user_id: a.id, name: old, is_active: false })).error);
    const r = await save(a, { tax_category: "Vehicle/Fuel" });

    const ok = await preview(a, [r.id], mine);
    assert.equal(ok.will_change, 1);
    assert.equal((await run(a, { mode: "preview", ids: [r.id], category: old })).status, 400, "a deactivated category is not a target");
    assert.equal((await run(b, { mode: "preview", ids: [r.id], category: mine })).status, 400, "someone else's custom category does not exist for b");
  });

  it("4. another owner's expenses are invisible and untouchable", async () => {
    const mineRow = await save(a, { tax_category: "Vehicle/Fuel" });
    // b asks about a's row: it isn't theirs, so it is "missing", and nothing can change.
    const plan = await preview(b, [mineRow.id], "Tools & Equipment");
    assert.equal(plan.missing, 1);
    assert.equal(plan.will_change, 0);
    // Even a hand-built apply naming a's row, as b, changes nothing.
    const res = await run(b, { mode: "apply", category: "Tools & Equipment", changes: [{ id: mineRow.id, from: "Vehicle/Fuel" }] });
    assert.equal(res.status, 409);
    assert.equal((await fetchRow(a, mineRow.id)).tax_category, "Vehicle/Fuel");
    // And undo as b can't move it either.
    const undo = await run(b, { mode: "undo", category: "Vehicle/Fuel", changes: [{ id: mineRow.id, from: "Tools & Equipment" }] });
    assert.equal(undo.body.restored, 0);
    assert.equal((await fetchRow(a, mineRow.id)).tax_category, "Vehicle/Fuel");
  });

  it("5. the 500 cap: 501 is refused, exactly 500 is accepted", async () => {
    const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
    assert.equal(BULK_CATEGORY_MAX, 500);
    const tooMany = await run(a, { mode: "preview", ids: ids(BULK_CATEGORY_MAX + 1), category: "Tools & Equipment" });
    assert.equal(tooMany.status, 400);
    const exactly = await run(a, { mode: "preview", ids: ids(BULK_CATEGORY_MAX), category: "Tools & Equipment" });
    assert.equal(exactly.status, 200);
    assert.equal((exactly.body.plan as { missing: number }).missing, BULK_CATEGORY_MAX);
    assert.equal((await run(a, { mode: "apply", category: "Tools & Equipment", changes: ids(501).map((id) => ({ id, from: "Vehicle/Fuel" })) })).status, 400);
  });

  it("6. stale preview: if any row changed since, NOTHING is written", async () => {
    const x = await save(a, { tax_category: "Vehicle/Fuel" });
    const y = await save(a, { tax_category: "Vehicle/Fuel" });
    const plan = await preview(a, [x.id, y.id], "Tools & Equipment");
    // y is edited after the preview (here: another tab moved it).
    assert.ifError((await a.client.from("receipts").update({ tax_category: "Office/Admin" }).eq("id", y.id)).error);

    const res = await run(a, { mode: "apply", category: "Tools & Equipment", changes: plan.changes });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "STALE_PREVIEW");
    assert.equal((await fetchRow(a, x.id)).tax_category, "Vehicle/Fuel", "x was not moved either");
    assert.equal((await fetchRow(a, y.id)).tax_category, "Office/Admin");

    // A deleted row is stale too.
    assert.ifError((await a.client.from("receipts").delete().eq("id", y.id)).error);
    assert.equal((await run(a, { mode: "apply", category: "Tools & Equipment", changes: plan.changes })).status, 409);
    assert.equal((await fetchRow(a, x.id)).tax_category, "Vehicle/Fuel");
  });

  it("7. Meals on either side needs its own confirmation - the server refuses without it", async () => {
    const m = await save(a, { tax_category: "Meals", total_amount: 565, tax_amount: 65 });
    const s = await save(a, { tax_category: "Supplies" });

    const out = await preview(a, [m.id], "Supplies");
    assert.equal(out.meals_involved, true);
    const refused = await run(a, { mode: "apply", category: "Supplies", changes: out.changes });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "MEALS_CONFIRM_REQUIRED");
    assert.equal((await fetchRow(a, m.id)).tax_category, "Meals", "nothing moved without the confirmation");
    const falsy = await run(a, { mode: "apply", category: "Supplies", changes: out.changes, confirm_meals: "yes" });
    assert.equal(falsy.status, 400, "only a real true counts");

    const done = await run(a, { mode: "apply", category: "Supplies", changes: out.changes, confirm_meals: true });
    assert.equal(done.status, 200);
    const afterRow = await fetchRow(a, m.id);
    assert.equal(afterRow.tax_category, "Supplies");
    assert.equal(Number(afterRow.tax_amount), 65, "the tax stayed exactly as it was");

    // Into Meals needs it as well.
    const into = await preview(a, [s.id], "Meals");
    assert.equal(into.meals_involved, true);
    assert.equal((await run(a, { mode: "apply", category: "Meals", changes: into.changes })).status, 400);
  });

  it("8. undo puts rows back - but one edited since is left alone", async () => {
    const p = await save(a, { tax_category: "Vehicle/Fuel" });
    const q = await save(a, { tax_category: "Office/Admin" });
    const plan = await preview(a, [p.id, q.id], "Tools & Equipment");
    const applied = await run(a, { mode: "apply", category: "Tools & Equipment", changes: plan.changes });
    assert.equal(applied.status, 200);
    // q is changed by hand afterwards.
    assert.ifError((await a.client.from("receipts").update({ tax_category: "Gas" }).eq("id", q.id)).error);

    const undo = await run(a, { mode: "undo", category: "Tools & Equipment", changes: applied.body.previous });
    assert.equal(undo.status, 200);
    assert.equal(undo.body.restored, 1);
    assert.equal(undo.body.left_alone, 1);
    assert.equal((await fetchRow(a, p.id)).tax_category, "Vehicle/Fuel");
    assert.equal((await fetchRow(a, q.id)).tax_category, "Gas", "the later hand edit is not overwritten");
  });

  it("9. a bulk change never learns a vendor rule and never touches the statement lines", async () => {
    const before = await admin.from("vendor_rules").select("*", { count: "exact", head: true }).eq("user_id", a.id);
    const r = await save(a, { tax_category: "Vehicle/Fuel", merchant_name: "Rule Bait Vendor" });
    const plan = await preview(a, [r.id], "Tools & Equipment");
    assert.equal((await run(a, { mode: "apply", category: "Tools & Equipment", changes: plan.changes })).status, 200);
    const afterRules = await admin.from("vendor_rules").select("*", { count: "exact", head: true }).eq("user_id", a.id);
    assert.equal(afterRules.count, before.count, "no rule was created or changed");
  });

  it("10. rows already in the target are skipped, and applying with nothing to change is refused", async () => {
    const r = await save(a, { tax_category: "Tools & Equipment" });
    const plan = await preview(a, [r.id], "Tools & Equipment");
    assert.equal(plan.will_change, 0);
    assert.equal((await run(a, { mode: "apply", category: "Tools & Equipment", changes: [] })).status, 400);
    // A hand-built change claiming it moves FROM the target is refused.
    assert.equal((await run(a, { mode: "apply", category: "Tools & Equipment", changes: [{ id: r.id, from: "Tools & Equipment" }] })).status, 400);
  });
});
