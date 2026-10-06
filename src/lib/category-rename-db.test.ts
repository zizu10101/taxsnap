import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Renaming a custom expense category, end to end, as REAL SIGNED-IN USERS (not the
// service role) against the real rename_expense_category() - the function migration
// 0054 replaced. A rename must carry onto the owner's receipts and templates (as it
// always did) AND, since 0054, onto their vendor rules and open statement drafts -
// without touching committed statement history, and without ever touching anyone else's
// rows. A second user is the bystander that proves the last part.
//
// Runs against the REAL project (shared with production), so it is OFF unless
//   RUN_DB_ISOLATION_TEST=1 node --env-file=.env.local --test src/lib/category-rename-db.test.ts
// It creates two throwaway users and always deletes both, verifying nothing is left.

const RUN = process.env.RUN_DB_ISOLATION_TEST === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ORIGINAL = "Rename Test Cat";
const RENAMED = "Renamed Test Cat";
const password = `Pw-${randomUUID()}`;

interface Person {
  id: string;
  client: SupabaseClient;
  cardId: string;
  categoryId: string;
  receiptId: string;
  templateId: string;
  draftLineId: string;
  committedLineId: string;
}

describe("renaming a custom category as a signed-in user", { skip: !RUN || !URL_ || !ANON || !SERVICE }, () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let a: Person;
  let b: Person;
  const created: string[] = [];

  async function makePerson(label: string): Promise<Person> {
    const email = `category-rename-${label}-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    const id = data.user!.id;
    created.push(id);

    // Signed in as the person, exactly as the app's own routes act.
    const client = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);

    // Their custom category, an expense and a template that use it - all through their own session (RLS).
    const cat = await client.from("expense_categories").insert({ user_id: id, name: ORIGINAL }).select("id").single();
    assert.ifError(cat.error);
    const receipt = await client
      .from("receipts")
      .insert({ user_id: id, merchant_name: `EXPENSE ${label}`, transaction_date: "2026-04-04", total_amount: 12.34, tax_category: ORIGINAL })
      .select("id")
      .single();
    assert.ifError(receipt.error);
    const template = await client
      .from("expense_templates")
      .insert({ user_id: id, name: `Template ${label}`, description: "Monthly thing", default_amount: 50, default_tax_category: ORIGINAL })
      .select("id")
      .single();
    assert.ifError(template.error);

    // The 0054 side: a card, a vendor rule on it, and a statement draft with one open and one committed line.
    const card = await admin
      .from("bank_accounts")
      .insert({ user_id: id, name: `Card ${label}`, account_type: "card" })
      .select("id")
      .single();
    assert.ifError(card.error);
    const learned = await admin.rpc("learn_vendor_rule", {
      p_user_id: id,
      p_account_id: card.data!.id,
      p_vendor_key: "renametest",
      p_vendor_label: "RenameTest",
      p_category: ORIGINAL,
      p_paid_with_account_id: null,
    });
    assert.ifError(learned.error);
    assert.equal(learned.data, true);

    const imp = await admin.rpc("start_statement_import", {
      p_user_id: id,
      p_account_id: card.data!.id,
      p_file_sha256: randomUUID().replace(/-/g, "").padEnd(64, "0"),
      p_page_count: 1,
      p_chunks: [{ page_from: 1, page_to: 1 }],
      p_monthly_cap: null,
    });
    assert.ifError(imp.error);
    const line = (n: number, description: string) => ({
      page: 1, line_no: n, txn_date: "2026-04-05", description, amount: 20 + n, kind: "purchase", currency: "CAD",
    });
    assert.ifError(
      (
        await admin.rpc("save_chunk_result", {
          p_user_id: id,
          p_import_id: imp.data,
          p_chunk_no: 1,
          p_lines: [line(1, "OPEN DRAFT LINE"), line(2, "COMMITTED HISTORY LINE")],
          p_header: null,
          p_input_tokens: 1,
          p_output_tokens: 1,
        })
      ).error,
    );
    const lines = (await admin.from("statement_lines").select("id, line_no").eq("import_id", imp.data).order("line_no")).data!;
    assert.ifError(
      (
        await admin
          .from("statement_lines")
          .update({ category: ORIGINAL, category_confirmed: true, suggested_category: ORIGINAL, model_suggested_category: ORIGINAL, resolution: "new_expense" })
          .eq("id", lines[0].id)
      ).error,
    );
    assert.ifError(
      (
        await admin
          .from("statement_lines")
          .update({ category: ORIGINAL, category_confirmed: true, resolution: "new_expense", committed: true })
          .eq("id", lines[1].id)
      ).error,
    );

    return {
      id, client, cardId: card.data!.id, categoryId: cat.data!.id, receiptId: receipt.data!.id,
      templateId: template.data!.id, draftLineId: lines[0].id, committedLineId: lines[1].id,
    };
  }

  // Everything that mentions the category, read back as the service role.
  async function snapshot(p: Person) {
    const cat = (await admin.from("expense_categories").select("name").eq("id", p.categoryId).single()).data!.name;
    const receipt = (await admin.from("receipts").select("tax_category").eq("id", p.receiptId).single()).data!.tax_category;
    const template = (await admin.from("expense_templates").select("default_tax_category").eq("id", p.templateId).single()).data!.default_tax_category;
    const rules = (await admin.from("vendor_rules").select("account_id, category, times_confirmed, times_overridden").eq("user_id", p.id)).data!;
    const draft = (await admin.from("statement_lines").select("category, suggested_category, model_suggested_category").eq("id", p.draftLineId).single()).data!;
    const committed = (await admin.from("statement_lines").select("category").eq("id", p.committedLineId).single()).data!.category;
    return { cat, receipt, template, rules, draft, committed };
  }

  const expectAll = (s: Awaited<ReturnType<typeof snapshot>>, name: string, committedName: string) => {
    assert.equal(s.cat, name, "the category itself");
    assert.equal(s.receipt, name, "the expense follows");
    assert.equal(s.template, name, "the template follows");
    assert.equal(s.rules.length, 2, "the per-card rule and the any-card fallback both exist");
    assert.ok(s.rules.every((r) => r.category === name), "both rules follow");
    assert.ok(s.rules.every((r) => r.times_confirmed === 1 && r.times_overridden === 0), "a rename is not a confirmation or an override");
    assert.deepEqual(s.draft, { category: name, suggested_category: name, model_suggested_category: name }, "the open draft line follows");
    assert.equal(s.committed, committedName, "committed statement history is left exactly as it was");
  };

  before(async () => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
    anon = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    a = await makePerson("a");
    b = await makePerson("b");
  });

  after(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    if (created.length > 0) {
      for (const table of ["expense_categories", "receipts", "expense_templates", "vendor_rules", "statement_imports", "statement_lines", "bank_accounts"] as const) {
        const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("user_id", created);
        assert.equal(count, 0, `leftover rows in ${table}`);
      }
      const { count } = await admin.from("profiles").select("*", { count: "exact", head: true }).in("id", created);
      assert.equal(count, 0, "leftover profiles");
    }
  });

  it("before the rename, everything uses the original name", async () => {
    expectAll(await snapshot(a), ORIGINAL, ORIGINAL);
    expectAll(await snapshot(b), ORIGINAL, ORIGINAL);
  });

  it("renaming as the signed-in user carries onto the expense, the template, the rules and the open draft", async () => {
    // A second spelling of the same category (case and spacing) follows too, as it always has.
    const sloppy = await a.client
      .from("receipts")
      .insert({ user_id: a.id, merchant_name: "SLOPPY SPELLING", transaction_date: "2026-04-06", total_amount: 1, tax_category: ` ${ORIGINAL.toUpperCase()} ` })
      .select("id")
      .single();
    assert.ifError(sloppy.error);

    const res = await a.client.rpc("rename_expense_category", { p_id: a.categoryId, p_new_name: RENAMED });
    assert.ifError(res.error);
    assert.equal((res.data as { name: string }).name, RENAMED);

    expectAll(await snapshot(a), RENAMED, ORIGINAL);
    assert.equal((await admin.from("receipts").select("tax_category").eq("id", sloppy.data!.id).single()).data!.tax_category, RENAMED);
  });

  it("...and touched nothing of the other user's, who has a category, rules and drafts with the very same name", async () => {
    expectAll(await snapshot(b), ORIGINAL, ORIGINAL);
  });

  it("renaming it back restores everything, with the counters still untouched", async () => {
    const res = await a.client.rpc("rename_expense_category", { p_id: a.categoryId, p_new_name: ORIGINAL });
    assert.ifError(res.error);
    expectAll(await snapshot(a), ORIGINAL, ORIGINAL);
    expectAll(await snapshot(b), ORIGINAL, ORIGINAL);
  });

  it("a user can't rename someone else's category", async () => {
    const res = await a.client.rpc("rename_expense_category", { p_id: b.categoryId, p_new_name: "Hijacked" });
    assert.match(res.error?.message ?? "", /CATEGORY_NOT_FOUND/);
    expectAll(await snapshot(b), ORIGINAL, ORIGINAL);
  });

  it("the follow-on helper, called directly, can only ever change the caller's own rows", async () => {
    // B calls it directly, naming the shared category: B's own rows change...
    assert.ifError((await b.client.rpc("follow_category_rename", { p_old: ORIGINAL, p_new: "Changed By B" })).error);
    const mine = await snapshot(b);
    assert.ok(mine.rules.every((r) => r.category === "Changed By B"));
    assert.equal(mine.draft.category, "Changed By B");
    // ...and A's are exactly as they were, as are B's committed history and expenses.
    expectAll(await snapshot(a), ORIGINAL, ORIGINAL);
    assert.equal(mine.committed, ORIGINAL);
    assert.equal(mine.receipt, ORIGINAL);
  });

  it("a signed-out caller can't use the helper", async () => {
    const res = await anon.rpc("follow_category_rename", { p_old: ORIGINAL, p_new: "Nope" });
    assert.ok(res.error, "anon must be refused");
    assert.equal(res.error.code, "42501");
  });
});
