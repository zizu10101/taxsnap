import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { materializeStatementTaxes } from "./statement-tax-server.ts";
import { handleBulkCategory } from "./bulk-category-server.ts";
import { handleBulkTaxCode } from "./bulk-tax-code-server.ts";
import { calculateHSTReturn } from "./hst.ts";

// Tax codes against the real database (migration 0057): what commit_statement_import copies onto the
// new expenses, the table constraints, and bulk recategorize recomputing CALCULATED rows while never
// touching CONFIRMED ones - the last part as a REAL SIGNED-IN USER, like the app.
//
// It talks to the REAL project (shared with production), so it is OFF unless
//   RUN_DB_ISOLATION_TEST=1 node --env-file=.env.local --test src/lib/tax-codes-db.test.ts
// and it SKIPS ITSELF until 0057 is applied. It creates a throwaway user and always deletes it,
// verifying nothing is left.

const RUN = process.env.RUN_DB_ISOLATION_TEST === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = `Pw-${randomUUID()}`;
const sha = () => randomUUID().replace(/-/g, "").padEnd(64, "0");

describe("tax codes (real database)", { skip: !RUN || !URL_ || !ANON || !SERVICE }, () => {
  let admin: SupabaseClient;
  let hasColumns = false;
  let userId: string;
  let cardId: string;
  let me: SupabaseClient;
  const created: string[] = [];

  before(async () => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
    hasColumns = !(await admin.from("receipts").select("tax_rate").limit(1)).error;
    if (!hasColumns) return;
    const email = `tax-codes-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    userId = data.user!.id;
    created.push(userId);
    const { data: card } = await admin
      .from("bank_accounts")
      .insert({ user_id: userId, name: "Test card", account_type: "card" })
      .select("id")
      .single();
    cardId = card!.id;
    // Every real owner has this category once a statement using it has been saved; undo only restores
    // into a category that exists for the owner, so the test needs it too.
    assert.ifError((await admin.from("expense_categories").insert({ user_id: userId, name: "Bank charges" })).error);
    me = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    assert.ifError((await me.auth.signInWithPassword({ email, password })).error);
  });

  after(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    if (created.length > 0) {
      for (const table of ["statement_imports", "statement_lines", "bank_accounts", "receipts", "expense_categories"] as const) {
        const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("user_id", created);
        assert.equal(count, 0, `leftover rows in ${table}`);
      }
    }
  });

  const skipIfMissing = (t: { skip: (m: string) => void }) => {
    if (!hasColumns) t.skip("migration 0057 is not applied yet");
    return !hasColumns;
  };

  // An import with the given lines, finalized and ready for decisions.
  async function readyImport(rows: Record<string, unknown>[]) {
    const { data: id, error } = await admin.rpc("start_statement_import", {
      p_user_id: userId,
      p_account_id: cardId,
      p_file_sha256: sha(),
      p_page_count: 1,
      p_chunks: [{ page_from: 1, page_to: 1 }],
      p_monthly_cap: null,
    });
    assert.ifError(error);
    const lines = rows.map((r, i) => ({
      page: 1,
      line_no: i + 1,
      txn_date: "2026-09-10",
      description: `TEST MERCHANT ${i}`,
      amount: 25,
      kind: "purchase",
      currency: "CAD",
      original_amount: null,
      original_currency: null,
      suggested_category: null,
      ...r,
    }));
    assert.ifError(
      (
        await admin.rpc("save_chunk_result", {
          p_user_id: userId,
          p_import_id: id,
          p_chunk_no: 1,
          p_lines: lines,
          p_header: null,
          p_input_tokens: 1,
          p_output_tokens: 1,
        })
      ).error,
    );
    assert.ifError((await admin.rpc("finalize_statement_lines", { p_user_id: userId, p_import_id: id })).error);
    return id as string;
  }

  const lineRows = async (importId: string) =>
    (await admin.from("statement_lines").select("*").eq("import_id", importId).order("line_no")).data!;
  const receiptOf = async (receiptId: string) =>
    (await admin.from("receipts").select("*").eq("id", receiptId).single()).data!;

  it("1. commit saves each expense with its resolved tax code and CALCULATED tax; an uncoded line is saved with tax 0 and no code", async (t) => {
    if (skipIfMissing(t)) return;
    const importId = await readyImport([
      { amount: 113 }, // 0: the owner picks "taxable"
      { amount: 12, kind: "fee" }, // 1: fees carry no tax
      { amount: 50 }, // 2: no code applies
      { amount: -113, kind: "refund" }, // 3: refund, owner picks "taxable"
      { amount: 80, original_currency: "USD", original_amount: 58 }, // 4: foreign currency
      { amount: 565 }, // 5: owner picks "meals"
    ]);
    const ls = await lineRows(importId);
    const decide = (i: number, extra: Record<string, unknown> = {}) =>
      admin
        .from("statement_lines")
        .update({ resolution: "new_expense", category: "Supplies", category_confirmed: true, ...extra })
        .eq("id", ls[i].id);
    const taxable = { tax_rate: 0.13, itc_pct: 1, deductible_pct: 1, tax_source: "line" };
    const meals = { tax_rate: 0.13, itc_pct: 0.5, deductible_pct: 0.5, tax_source: "line" };
    for (const [i, extra] of [[0, taxable], [1, {}], [2, {}], [3, taxable], [4, {}], [5, meals]] as const) {
      assert.ifError((await decide(i, extra)).error);
    }

    // The app writes the resolved tax onto the lines just before commit.
    const written = await materializeStatementTaxes(admin, admin, userId, importId, "Bank charges");
    assert.ok(written >= 4, `expected the derived/calculated lines to be written, got ${written}`);
    assert.equal(await materializeStatementTaxes(admin, admin, userId, importId, "Bank charges"), 0, "running it again writes nothing");

    const res = await admin.rpc("commit_statement_import", {
      p_user_id: userId,
      p_import_id: importId,
      p_reconcile_diff: null,
      p_reconcile_acknowledged: false,
    });
    assert.ifError(res.error);
    const after = await lineRows(importId);
    const expense = async (i: number) => receiptOf(after[i].created_receipt_id);

    const taxableRow = await expense(0);
    assert.deepEqual([Number(taxableRow.tax_amount), Number(taxableRow.tax_rate), Number(taxableRow.itc_pct), taxableRow.tax_source], [13, 0.13, 1, "line"]);
    assert.equal(taxableRow.from_statement && taxableRow.no_receipt, true, "still flagged as a statement expense with no receipt");

    const fee = await expense(1);
    assert.deepEqual([Number(fee.tax_amount), Number(fee.tax_rate), Number(fee.itc_pct), Number(fee.deductible_pct), fee.tax_source], [0, 0, 0, 1, "kind"]);

    const uncoded = await expense(2);
    assert.deepEqual([Number(uncoded.tax_amount), uncoded.tax_rate, uncoded.itc_pct, uncoded.tax_source], [0, null, null, null], "nothing calculated, nothing guessed");

    const refund = await expense(3);
    assert.equal(Number(refund.tax_amount), -13, "a refund reverses the tax with the same code");

    const foreign = await expense(4);
    assert.deepEqual([Number(foreign.tax_amount), foreign.tax_source], [0, "foreign_currency"]);

    const mealsRow = await expense(5);
    assert.deepEqual([Number(mealsRow.tax_amount), Number(mealsRow.itc_pct)], [65, 0.5], "the full 13% is stored; only half is claimable");
  });

  it("2. the constraints: all three numbers or none, a source with a code, and only a statement expense may carry one", async (t) => {
    if (skipIfMissing(t)) return;
    const base = { user_id: userId, merchant_name: "T", transaction_date: "2026-09-10", total_amount: 10, tax_category: "Supplies" };
    // an ordinary receipt can't carry a code
    const ordinary = await admin
      .from("receipts")
      .insert({ ...base, tax_rate: 0.13, itc_pct: 1, deductible_pct: 1, tax_source: "line" });
    assert.equal(ordinary.error?.code, "23514");
    // half a code, or a code without a source, is refused even on a statement expense
    for (const half of [
      { tax_rate: 0.13 },
      { tax_rate: 0.13, itc_pct: 1, deductible_pct: 1 },
      { tax_source: "line" },
    ]) {
      const r = await admin.from("receipts").insert({ ...base, from_statement: true, no_receipt: true, ...half });
      assert.equal(r.error?.code, "23514", JSON.stringify(half));
    }
    // out of range / unknown source
    const range = await admin
      .from("receipts")
      .insert({ ...base, from_statement: true, no_receipt: true, tax_rate: 7, itc_pct: 1, deductible_pct: 1, tax_source: "line" });
    assert.equal(range.error?.code, "23514");
    const src = await admin
      .from("receipts")
      .insert({ ...base, from_statement: true, no_receipt: true, tax_rate: 0.13, itc_pct: 1, deductible_pct: 1, tax_source: "magic" });
    assert.equal(src.error?.code, "23514");
    // a whole code on a statement expense is fine
    const ok = await admin
      .from("receipts")
      .insert({ ...base, from_statement: true, no_receipt: true, tax_rate: 0, itc_pct: 0, deductible_pct: 1, tax_source: "category" })
      .select("id")
      .single();
    assert.ifError(ok.error);
    // the same all-or-none rule on a statement line
    const importId = await readyImport([{ amount: 5 }]);
    const ls = await lineRows(importId);
    assert.equal((await admin.from("statement_lines").update({ tax_rate: 0.13 }).eq("id", ls[0].id)).error?.code, "23514");
  });

  // ---- bulk recategorize over calculated and confirmed rows ---------------------------------

  async function expenseRow(over: Record<string, unknown>) {
    const res = await admin
      .from("receipts")
      .insert({
        user_id: userId,
        merchant_name: "Bulk Test",
        transaction_date: "2026-09-10",
        total_amount: 113,
        tax_amount: 0,
        tax_category: "Bank charges",
        ...over,
      })
      .select("*")
      .single();
    assert.ifError(res.error);
    return res.data!;
  }
  const noTax = { from_statement: true, no_receipt: true, tax_rate: 0, itc_pct: 0, deductible_pct: 1, tax_source: "category" };
  const reread = async (id: string) => (await admin.from("receipts").select("*").eq("id", id).single()).data!;
  const run = (body: unknown) => handleBulkCategory(me, userId, body);

  it("3. bulk: a calculated row coded by its category follows the category; a confirmed row's tax is never touched; undo restores", async (t) => {
    if (skipIfMissing(t)) return;
    const calculated = await expenseRow(noTax);
    const scanned = await expenseRow({ tax_category: "Bank charges", tax_amount: 13 }); // an ordinary scanned receipt
    const attached = await expenseRow({ from_statement: true, no_receipt: false, tax_amount: 13 }); // a receipt was attached
    const ids = [calculated.id, scanned.id, attached.id];

    const preview = await run({ mode: "preview", ids, category: "Supplies" });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const plan = preview.body.plan as { recalculated: number; confirmed_untouched: number; changes: { id: string; prev?: unknown }[] };
    assert.equal(plan.recalculated, 1);
    assert.equal(plan.confirmed_untouched, 2);
    assert.ok(plan.changes.find((c) => c.id === calculated.id)?.prev, "the previous code is remembered for undo");

    const applied = await run({ mode: "apply", category: "Supplies", changes: plan.changes });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.recalculated, 1);

    const calcAfter = await reread(calculated.id);
    assert.equal(calcAfter.tax_category, "Supplies");
    assert.deepEqual([calcAfter.tax_rate, calcAfter.itc_pct, calcAfter.tax_source, Number(calcAfter.tax_amount)], [null, null, null, 0], "no default for Supplies: the code is dropped and nothing is guessed");
    for (const confirmed of [scanned, attached]) {
      const row = await reread(confirmed.id);
      assert.equal(row.tax_category, "Supplies");
      assert.equal(Number(row.tax_amount), 13, "a confirmed row keeps its tax_amount exactly");
    }

    // Undo puts the calculated row's code back.
    const undo = await run({ mode: "undo", category: "Supplies", changes: applied.body.previous });
    assert.equal(undo.status, 200);
    const back = await reread(calculated.id);
    assert.deepEqual([back.tax_category, Number(back.tax_rate), Number(back.itc_pct), back.tax_source], ["Bank charges", 0, 0, "category"]);
  });

  it("4. bulk: a code the owner picked on the line does not follow the category", async (t) => {
    if (skipIfMissing(t)) return;
    const picked = await expenseRow({ ...noTax, tax_source: "line", tax_rate: 0.13, itc_pct: 1, tax_amount: 13 });
    const plan = (await run({ mode: "preview", ids: [picked.id], category: "Supplies" })).body.plan as { recalculated: number; changes: unknown[] };
    assert.equal(plan.recalculated, 0);
    assert.equal((await run({ mode: "apply", category: "Supplies", changes: plan.changes })).status, 200);
    const row = await reread(picked.id);
    assert.deepEqual([row.tax_category, Number(row.tax_amount), row.tax_source], ["Supplies", 13, "line"]);
  });

  it("5. bulk undo after a receipt was attached: the category is restored but the receipt's tax is left alone", async (t) => {
    if (skipIfMissing(t)) return;
    const calculated = await expenseRow(noTax);
    const plan = (await run({ mode: "preview", ids: [calculated.id], category: "Supplies" })).body.plan as { changes: unknown[] };
    const applied = await run({ mode: "apply", category: "Supplies", changes: plan.changes });
    assert.equal(applied.status, 200);
    // a receipt is attached afterwards (what the attach route does)
    assert.ifError(
      (await admin.from("receipts").update({ no_receipt: false, tax_amount: 11.5, tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null }).eq("id", calculated.id)).error,
    );
    const undo = await run({ mode: "undo", category: "Supplies", changes: applied.body.previous });
    assert.equal(undo.status, 200);
    const row = await reread(calculated.id);
    assert.equal(row.tax_category, "Bank charges");
    assert.equal(Number(row.tax_amount), 11.5, "the attached receipt's actual tax is not overwritten");
    assert.equal(row.tax_rate, null);
  });

  // ---- bulk "Set tax code" -----------------------------------------------------------------

  const runTax = (body: unknown) => handleBulkTaxCode(me, userId, body);
  const readAll = async (ids: string[]) =>
    Object.fromEntries(
      ((await me.from("receipts").select("*").in("id", ids)).data ?? []).map((r) => [r.id as string, r as Record<string, unknown>]),
    );
  const uncodedRow = (over: Record<string, unknown> = {}) =>
    expenseRow({ tax_category: "Supplies", from_statement: true, no_receipt: true, ...over });

  it("6. bulk Set tax code: only calculated rows change; receipts, confirmed and typed rows are untouched; the Line 106 split moves", async (t) => {
    if (skipIfMissing(t)) return;
    const target = await uncodedRow();
    const typed = await uncodedRow({ total_amount: -113, tax_amount: -9.5 }); // a refund slip's HST, typed
    const attachedRow = await expenseRow({ tax_category: "Supplies", from_statement: true, no_receipt: false, tax_amount: 13 });
    const scannedRow = await expenseRow({ tax_category: "Supplies", tax_amount: 13 });
    const already = await uncodedRow({ tax_amount: 13, tax_rate: 0.13, itc_pct: 1, deductible_pct: 1, tax_source: "line" });
    const ids = [target.id, typed.id, attachedRow.id, scannedRow.id, already.id];
    const untouched = [typed.id, attachedRow.id, scannedRow.id, already.id];
    const snapshot = await readAll(untouched);
    const hstBefore = calculateHSTReturn(0, [], Object.values(await readAll(ids)) as never[]);

    const preview = await runTax({ mode: "preview", ids, code: "taxable" });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const plan = preview.body.plan as { will_change: number; skipped: Record<string, number>; changes: unknown[] };
    assert.equal(plan.will_change, 1);
    assert.deepEqual(plan.skipped, { has_receipt: 1, confirmed: 1, typed_figure: 1, already_set: 1 });

    const applied = await runTax({ mode: "apply", code: "taxable", changes: plan.changes });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.changed, 1);

    const row = await reread(target.id);
    assert.deepEqual([Number(row.tax_amount), Number(row.tax_rate), Number(row.itc_pct), row.tax_source], [13, 0.13, 1, "line"]);
    assert.deepEqual(await readAll(untouched), snapshot, "every other column of every skipped row is identical");

    const hstAfter = calculateHSTReturn(0, [], Object.values(await readAll(ids)) as never[]);
    assert.equal(hstAfter.line106Confirmed, hstBefore.line106Confirmed, "the receipt-backed part did not move");
    assert.equal(Number((hstAfter.line106Calculated - hstBefore.line106Calculated).toFixed(2)), 13, "the new code's ITC is in the calculated part");
    assert.equal(hstBefore.needsTaxCodeCount - hstAfter.needsTaxCodeCount, 1);

    // Undo puts the target back to "needs a tax code".
    const undo = await runTax({ mode: "undo", code: "taxable", changes: applied.body.previous });
    assert.equal(undo.body.restored, 1);
    const back = await reread(target.id);
    assert.deepEqual([Number(back.tax_amount), back.tax_rate, back.tax_source], [0, null, null]);
    assert.deepEqual(await readAll(untouched), snapshot);
  });

  it("7. bulk Set tax code: a receipt attached after the preview stops the whole apply; nothing is written", async (t) => {
    if (skipIfMissing(t)) return;
    const a1 = await uncodedRow();
    const a2 = await uncodedRow();
    const plan = (await runTax({ mode: "preview", ids: [a1.id, a2.id], code: "meals" })).body.plan as { changes: unknown[] };
    // a receipt is attached to a2 while the dialog is open (what the attach route does)
    assert.ifError((await admin.from("receipts").update({ no_receipt: false, tax_amount: 11.5 }).eq("id", a2.id)).error);
    const res = await runTax({ mode: "apply", code: "meals", changes: plan.changes });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "STALE_PREVIEW");
    const [r1, r2] = [await reread(a1.id), await reread(a2.id)];
    assert.deepEqual([Number(r1.tax_amount), r1.tax_rate, r1.tax_source], [0, null, null], "a1 was not written either");
    assert.equal(Number(r2.tax_amount), 11.5, "the attached receipt's actual tax stands");
    assert.equal(r2.tax_rate, null);
  });

  it("8. bulk Set tax code: undo leaves alone a row that was edited or given a receipt since", async (t) => {
    if (skipIfMissing(t)) return;
    const a1 = await uncodedRow();
    const a2 = await uncodedRow();
    const plan = (await runTax({ mode: "preview", ids: [a1.id, a2.id], code: "none" })).body.plan as { changes: unknown[] };
    const applied = await runTax({ mode: "apply", code: "none", changes: plan.changes });
    assert.equal(applied.status, 200);
    assert.ifError((await admin.from("receipts").update({ no_receipt: false, tax_amount: 5, tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null }).eq("id", a2.id)).error);
    const undo = await runTax({ mode: "undo", code: "none", changes: applied.body.previous });
    assert.deepEqual([undo.body.restored, undo.body.left_alone], [1, 1]);
    const [r1, r2] = [await reread(a1.id), await reread(a2.id)];
    assert.equal(r1.tax_rate, null, "a1 is back to needing a code");
    assert.equal(Number(r2.tax_amount), 5, "a2's receipt tax is not overwritten");
  });

  it("9. bulk Set tax code: another owner's expenses are invisible and untouchable; bad input is refused", async (t) => {
    if (skipIfMissing(t)) return;
    const mine = await uncodedRow();
    const otherEmail = `tax-codes-other-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email: otherEmail, password, email_confirm: true });
    assert.ifError(error);
    created.push(data.user!.id);
    const other = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    assert.ifError((await other.auth.signInWithPassword({ email: otherEmail, password })).error);

    const plan = (await handleBulkTaxCode(other, data.user!.id, { mode: "preview", ids: [mine.id], code: "taxable" })).body.plan as { missing: number; will_change: number };
    assert.deepEqual([plan.missing, plan.will_change], [1, 0]);
    const applied = await handleBulkTaxCode(other, data.user!.id, {
      mode: "apply",
      code: "taxable",
      changes: [{ id: mine.id, prev: { tax_amount: 0, tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null } }],
    });
    assert.equal(applied.status, 409);
    assert.equal(Number((await reread(mine.id)).tax_amount), 0);

    assert.equal((await runTax({ mode: "preview", ids: [mine.id], code: "gst5" })).status, 400, "unknown code");
    assert.equal((await runTax({ mode: "preview", ids: [], code: "taxable" })).status, 400);
    assert.equal((await runTax({ mode: "nope", ids: [mine.id], code: "taxable" })).status, 400);
    const tooMany = Array.from({ length: 501 }, () => randomUUID());
    assert.equal((await runTax({ mode: "preview", ids: tooMany, code: "taxable" })).status, 400);
    assert.equal((await runTax({ mode: "apply", code: "taxable", changes: [{ id: mine.id, prev: { tax_amount: 0 } }] })).status, 400, "a malformed previous state");
  });
});
