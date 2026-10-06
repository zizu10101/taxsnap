import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sanitizeChunk } from "./statement-lines.ts";
import {
  bankChargesSuggestion,
  resolveBankCharges,
  statementCategoryOptions,
} from "./statement-categories.ts";
import { ensureBankChargesCategory, loadCategoryRows } from "./statement-bank-charges.ts";

// The category statement import files interest and fees under - an ordinary custom
// category the owner can rename or remove - must survive being renamed and removed:
// a rename must not make the next import create a SECOND one, and a removal must not
// make the next import bring it back. Run end to end as a REAL SIGNED-IN USER against
// the real database (migration 0055 supplies the stable key it is found by), using the
// real extraction-side and save-side code: the fee suggestion (sanitizeChunk), the
// options, and ensureBankChargesCategory() exactly as the commit route calls it.
//
// Runs against the REAL project (shared with production), so it is OFF unless
//   RUN_DB_ISOLATION_TEST=1 node --env-file=.env.local --test src/lib/bank-charges-db.test.ts
// and it skips itself until 0055 is applied. It creates two throwaway users and always
// deletes them, verifying nothing is left.

const RUN = process.env.RUN_DB_ISOLATION_TEST === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const password = `Pw-${randomUUID()}`;

describe("the bank-charges category: rename, remove, restore, and saving statements with fees", { skip: !RUN || !URL_ || !ANON || !SERVICE }, () => {
  let admin: SupabaseClient;
  let hasKeyColumn = false;
  const created: string[] = [];

  interface Person {
    id: string;
    client: SupabaseClient;
    cardId: string;
  }
  let a: Person;
  let b: Person;
  let step = 0; // distinct amounts per statement, so no line is flagged "already imported"

  async function makePerson(label: string): Promise<Person> {
    const email = `bank-charges-${label}-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    created.push(data.user!.id);
    const client = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
    const card = await admin
      .from("bank_accounts")
      .insert({ user_id: data.user!.id, name: `Card ${label}`, account_type: "card" })
      .select("id")
      .single();
    assert.ifError(card.error);
    return { id: data.user!.id, client, cardId: card.data!.id };
  }

  // Everything the owner's categories look like, read as THEM (RLS), keyed rows included.
  const categoryRows = async (p: Person) =>
    (await p.client.from("expense_categories").select("id, name, is_active, system_key").eq("user_id", p.id)).data!;

  // Saves one statement containing a fee and an interest charge, the way the app does:
  // suggestions from the real sanitizer, the owner accepting them (or picking `fallback`
  // when nothing is suggested), then ensureBankChargesCategory() and the commit function.
  async function saveStatementWithFees(p: Person, fallback = "Other") {
    step += 1;
    const rows = await loadCategoryRows(p.client, p.id);
    const options = statementCategoryOptions(rows);
    const bank = resolveBankCharges(rows);
    const suggestedFor = bankChargesSuggestion(bank);

    const { lines } = sanitizeChunk(
      {
        lines: [
          { page_in_chunk: 1, date: "2026-09-10", description: "ANNUAL FEE", amount: 100 + step, kind: "fee" },
          { page_in_chunk: 1, date: "2026-09-11", description: "PURCHASE INTEREST", amount: 10 + step, kind: "interest" },
        ],
      },
      {
        pageFrom: 1,
        pageTo: 1,
        today: new Date().toISOString().slice(0, 10),
        periodStart: null,
        periodEnd: null,
        allowedCategories: options,
        bankChargesCategory: suggestedFor,
      },
    );

    const imp = await admin.rpc("start_statement_import", {
      p_user_id: p.id,
      p_account_id: p.cardId,
      p_file_sha256: randomUUID().replace(/-/g, "").padEnd(64, "0"),
      p_page_count: 1,
      p_chunks: [{ page_from: 1, page_to: 1 }],
      p_monthly_cap: null,
    });
    assert.ifError(imp.error);
    assert.ifError(
      (await admin.rpc("save_chunk_result", { p_user_id: p.id, p_import_id: imp.data, p_chunk_no: 1, p_lines: lines, p_header: null, p_input_tokens: 1, p_output_tokens: 1 })).error,
    );
    assert.ifError((await admin.rpc("finalize_statement_lines", { p_user_id: p.id, p_import_id: imp.data })).error);

    const saved = (await admin.from("statement_lines").select("id, suggested_category").eq("import_id", imp.data).order("line_no")).data!;
    const suggestions = saved.map((l) => l.suggested_category);
    // The owner accepts the suggestion, or - with none - picks a category by hand.
    for (const l of saved) {
      const category = l.suggested_category ?? fallback;
      assert.ifError(
        (await admin.from("statement_lines").update({ category, category_confirmed: true, resolution: "new_expense" }).eq("id", l.id)).error,
      );
    }

    // Exactly what the commit route does before calling the function.
    const used = (await admin.from("statement_lines").select("category").eq("import_id", imp.data)).data!.map((l) => l.category);
    const ensured = await ensureBankChargesCategory(p.client, p.id, used);
    assert.ifError((await admin.rpc("commit_statement_import", { p_user_id: p.id, p_import_id: imp.data, p_reconcile_diff: null, p_reconcile_acknowledged: false })).error);

    const expenses = (await admin.from("receipts").select("merchant_name, tax_category").eq("user_id", p.id).in("total_amount", [100 + step, 10 + step])).data!;
    return { suggestions, ensured, options, expenseCategories: expenses.map((e) => e.tax_category).sort() };
  }

  before(async () => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
    hasKeyColumn = !(await admin.from("expense_categories").select("system_key").limit(1)).error;
    if (!hasKeyColumn) return;
    a = await makePerson("a");
    b = await makePerson("b");
  });

  after(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    if (created.length > 0) {
      for (const table of ["expense_categories", "receipts", "statement_imports", "statement_lines", "bank_accounts"] as const) {
        const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("user_id", created);
        assert.equal(count, 0, `leftover rows in ${table}`);
      }
    }
  });

  it("1. a first statement with fees creates ONE keyed category and files the fees under it", async (t) => {
    if (!hasKeyColumn) return t.skip("migration 0055 is not applied yet");
    assert.equal((await categoryRows(a)).length, 0, "precondition: the owner has no custom categories");

    const r = await saveStatementWithFees(a);
    assert.deepEqual(r.suggestions, ["Bank charges", "Bank charges"]);
    assert.equal(r.ensured.outcome, "created");
    assert.deepEqual(r.expenseCategories, ["Bank charges", "Bank charges"]);

    const rows = await categoryRows(a);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].name, rows[0].is_active, rows[0].system_key], ["Bank charges", true, "bank_charges"]);
  });

  it("2. RENAMED to 'Bank fees': earlier expenses follow, and the next statement uses it - no second category", async (t) => {
    if (!hasKeyColumn) return t.skip("migration 0055 is not applied yet");
    const [row] = await categoryRows(a);
    const rename = await a.client.rpc("rename_expense_category", { p_id: row.id, p_new_name: "Bank fees" });
    assert.ifError(rename.error);
    assert.equal(
      (await admin.from("receipts").select("tax_category").eq("user_id", a.id).in("total_amount", [101, 11])).data!.every((e) => e.tax_category === "Bank fees"),
      true,
      "the expenses already saved follow the rename",
    );

    const r = await saveStatementWithFees(a);
    assert.deepEqual(r.suggestions, ["Bank fees", "Bank fees"], "fees are suggested under the NEW name");
    assert.equal(r.ensured.outcome, "none", "nothing needs creating");
    assert.deepEqual(r.expenseCategories, ["Bank fees", "Bank fees"]);
    assert.ok(!r.options.includes("Bank charges"), "the old default name is not offered next to it");

    const rows = await categoryRows(a);
    assert.equal(rows.length, 1, "still exactly one category - no second 'Bank charges'");
    assert.deepEqual([rows[0].name, rows[0].system_key], ["Bank fees", "bank_charges"]);
  });

  it("3. REMOVED: the next statement suggests nothing for fees and does not bring the category back", async (t) => {
    if (!hasKeyColumn) return t.skip("migration 0055 is not applied yet");
    const [row] = await categoryRows(a);
    // Exactly what the Settings "Remove" button does (PATCH is_active = false), as the owner.
    assert.ifError((await a.client.from("expense_categories").update({ is_active: false }).eq("id", row.id)).error);

    const r = await saveStatementWithFees(a, "Other");
    assert.deepEqual(r.suggestions, [null, null], "no bank-charges suggestion for a removed category");
    assert.equal(r.ensured.outcome, "none");
    assert.ok(!r.options.includes("Bank fees") && !r.options.includes("Bank charges"), "not offered");
    assert.deepEqual(r.expenseCategories, ["Other", "Other"], "the owner filed them by hand");

    const rows = await categoryRows(a);
    assert.equal(rows.length, 1, "not recreated");
    assert.deepEqual([rows[0].name, rows[0].is_active], ["Bank fees", false], "and not reactivated");
    // The earlier expenses keep their history.
    assert.equal(
      (await admin.from("receipts").select("tax_category").eq("user_id", a.id).in("total_amount", [101, 11])).data!.every((e) => e.tax_category === "Bank fees"),
      true,
    );
  });

  it("4. RESTORED in Settings: the next statement suggests it again, under its current name", async (t) => {
    if (!hasKeyColumn) return t.skip("migration 0055 is not applied yet");
    const [row] = await categoryRows(a);
    assert.ifError((await a.client.from("expense_categories").update({ is_active: true }).eq("id", row.id)).error);

    const r = await saveStatementWithFees(a);
    assert.deepEqual(r.suggestions, ["Bank fees", "Bank fees"]);
    assert.deepEqual(r.expenseCategories, ["Bank fees", "Bank fees"]);
    assert.equal((await categoryRows(a)).length, 1);
  });

  it("5. an existing unkeyed 'Bank charges' (made by hand, or before 0055) is adopted and keyed - never duplicated", async (t) => {
    if (!hasKeyColumn) return t.skip("migration 0055 is not applied yet");
    const own = await b.client.from("expense_categories").insert({ user_id: b.id, name: "Bank charges" }).select("id, system_key").single();
    assert.ifError(own.error);
    assert.equal(own.data!.system_key, null, "precondition: it has no key");

    const r = await saveStatementWithFees(b);
    assert.deepEqual(r.suggestions, ["Bank charges", "Bank charges"]);
    assert.equal(r.ensured.outcome, "keyed");

    const rows = await categoryRows(b);
    assert.equal(rows.length, 1, "no duplicate");
    assert.equal(rows[0].system_key, "bank_charges", "and it can now be renamed safely");
  });

  it("6. at most one category per owner can hold the key (the database enforces it)", async (t) => {
    if (!hasKeyColumn) return t.skip("migration 0055 is not applied yet");
    const second = await b.client.from("expense_categories").insert({ user_id: b.id, name: "A second one", system_key: "bank_charges" });
    assert.equal(second.error?.code, "23505");
  });

  it("7. the other owner is unaffected by all of this", async (t) => {
    if (!hasKeyColumn) return t.skip("migration 0055 is not applied yet");
    const bRows = await categoryRows(b);
    assert.deepEqual(bRows.map((r) => [r.name, r.is_active]), [["Bank charges", true]]);
  });
});
