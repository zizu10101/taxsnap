import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  alreadyImportedFor,
  applyStatementDelete,
  countDeletedStatements,
  findStatementForReceipt,
  loadStatementDetail,
  loadStatementList,
  monthlyImportUsage,
  previewStatementDelete,
  releaseForReimport,
  restoreAfterFailedReimport,
} from "./statement-groups-server.ts";
import type { DeleteExpectation } from "./statement-delete.ts";

// Saved-statement grouping against the real database (migration 0058: statement_lines.released_at /
// released_from), as REAL SIGNED-IN USERS for every read and as the service role only for the writes
// the app itself makes with it. A second user is the bystander.
//
// Runs against the REAL project (shared with production), so it is OFF unless
//   RUN_DB_ISOLATION_TEST=1 node --env-file=.env.local --test src/lib/statement-groups-db.test.ts
// and it SKIPS ITSELF until 0058 is applied. It creates throwaway users and always deletes them,
// verifying nothing is left.

const RUN = process.env.RUN_DB_ISOLATION_TEST === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = `Pw-${randomUUID()}`;
const sha = () => randomUUID().replace(/-/g, "").padEnd(64, "0");

describe("saved statement grouping (real database)", { skip: !RUN || !URL_ || !ANON || !SERVICE }, () => {
  let admin: SupabaseClient;
  let hasColumns = false;
  const created: string[] = [];
  interface Person {
    id: string;
    client: SupabaseClient;
    cardId: string;
  }
  let me: Person;
  let other: Person;

  async function makePerson(label: string): Promise<Person> {
    const email = `statement-groups-${label}-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    created.push(data.user!.id);
    const { data: card } = await admin
      .from("bank_accounts")
      .insert({ user_id: data.user!.id, name: `Card ${label}`, account_type: "card" })
      .select("id")
      .single();
    const client = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
    return { id: data.user!.id, client, cardId: card!.id };
  }

  before(async () => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
    hasColumns = !(await admin.from("statement_lines").select("released_at").limit(1)).error;
    if (!hasColumns) return;
    me = await makePerson("me");
    other = await makePerson("other");
  });

  after(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    if (created.length > 0) {
      for (const table of ["statement_imports", "statement_lines", "bank_accounts", "receipts"] as const) {
        const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("user_id", created);
        assert.equal(count, 0, `leftover rows in ${table}`);
      }
    }
  });

  const skipIfMissing = (t: { skip: (m: string) => void }) => {
    if (!hasColumns) t.skip("migration 0058 is not applied yet");
    return !hasColumns;
  };

  async function ordinaryReceipt(p: Person, over: Record<string, unknown> = {}) {
    const res = await admin
      .from("receipts")
      .insert({ user_id: p.id, merchant_name: "Hardware", transaction_date: "2026-02-08", total_amount: 75, tax_amount: 8.63, tax_category: "Supplies", ...over })
      .select("*")
      .single();
    assert.ifError(res.error);
    return res.data!;
  }

  // A SAVED import: 0 and 1 become expenses, 2 is matched to an ordinary receipt, 3 is excluded and
  // 4 is a payment. Returns everything a test needs to poke at.
  async function savedImport(p: Person = me, hash = sha()) {
    const { data: importId, error } = await admin.rpc("start_statement_import", {
      p_user_id: p.id,
      p_account_id: p.cardId,
      p_file_sha256: hash,
      p_page_count: 1,
      p_chunks: [{ page_from: 1, page_to: 1 }],
      p_monthly_cap: null,
    });
    assert.ifError(error);
    const rows = [
      { amount: 113, description: "VENDOR ONE" },
      { amount: 50, description: "VENDOR TWO" },
      { amount: 75, description: "HARDWARE STORE" },
      { amount: 20, description: "EXCLUDED THING" },
      { amount: -100, description: "PAYMENT - THANK YOU", kind: "payment" },
    ].map((r, i) => ({
      page: 1,
      line_no: i + 1,
      txn_date: "2026-02-08",
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
          p_user_id: p.id,
          p_import_id: importId,
          p_chunk_no: 1,
          p_lines: rows,
          p_header: { issuer: "TD", period_start: "2026-01-06", period_end: "2026-02-05", opening_balance: 0, closing_balance: 58 },
          p_input_tokens: 1,
          p_output_tokens: 1,
        })
      ).error,
    );
    assert.ifError((await admin.rpc("finalize_statement_lines", { p_user_id: p.id, p_import_id: importId })).error);
    const ls = (await admin.from("statement_lines").select("*").eq("import_id", importId).order("line_no")).data!;
    const matchedReceipt = await ordinaryReceipt(p);
    for (const i of [0, 1]) {
      assert.ifError(
        (await admin.from("statement_lines").update({ resolution: "new_expense", category: "Supplies", category_confirmed: true }).eq("id", ls[i].id)).error,
      );
    }
    assert.ifError(
      (await admin.from("statement_lines").update({ resolution: "matched", matched_receipt_id: matchedReceipt.id }).eq("id", ls[2].id)).error,
    );
    assert.ifError((await admin.from("statement_lines").update({ resolution: "skipped" }).eq("id", ls[3].id)).error);
    const committed = await admin.rpc("commit_statement_import", {
      p_user_id: p.id,
      p_import_id: importId,
      p_reconcile_diff: 0,
      p_reconcile_acknowledged: false,
    });
    assert.ifError(committed.error);
    const after = (await admin.from("statement_lines").select("*").eq("import_id", importId).order("line_no")).data!;
    return {
      importId: importId as string,
      hash,
      lines: after,
      expenseA: after[0].created_receipt_id as string,
      expenseB: after[1].created_receipt_id as string,
      matchedReceipt,
    };
  }

  const lineOf = async (id: string) => (await admin.from("statement_lines").select("*").eq("id", id).single()).data!;
  const expectOf = (body: Record<string, unknown>) => body.expect as DeleteExpectation;

  it("1. the list and the detail summarise a saved statement exactly, with no backfill", async (t) => {
    if (skipIfMissing(t)) return;
    const s = await savedImport();
    const list = await loadStatementList(me.client, me.id);
    const item = list.find((i) => i.id === s.importId)!;
    assert.ok(item, "an existing saved import appears in the list");
    assert.equal(item.account_name, "Card me");
    assert.deepEqual(
      [item.summary.created, item.summary.created_remaining, item.summary.matched, item.summary.skipped, item.summary.free.total],
      [2, 2, 1, 2, 1],
    );
    assert.equal(item.reconcile.label, "Reconciled");

    const detail = (await loadStatementDetail(me.client, me.id, s.importId))!;
    const byOutcome = (o: string) => detail.lines.filter((l) => l.outcome === o);
    assert.equal(byOutcome("new_expense").length, 2);
    assert.equal(byOutcome("matched").length, 1);
    assert.equal(byOutcome("excluded").length, 1);
    assert.equal(byOutcome("payment").length, 1);
    assert.equal(byOutcome("new_expense")[0].receipt?.has_receipt, false, "no receipt attached yet");
    assert.equal(byOutcome("matched")[0].receipt?.id, s.matchedReceipt.id);
  });

  it("2. Delete statement: no-receipt expenses are deleted, a receipt-attached one stays linked, a matched receipt is never deleted, the import is discarded and the same file starts again", async (t) => {
    if (skipIfMissing(t)) return;
    const s = await savedImport();
    // a receipt gets attached to expense B (what the attach route does)
    assert.ifError((await admin.from("receipts").update({ no_receipt: false, tax_amount: 5.75 }).eq("id", s.expenseB)).error);

    const preview = await previewStatementDelete(me.client, me.id, s.importId);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const counts = (preview.body.plan as { counts: Record<string, number> }).counts;
    assert.deepEqual([counts.delete, counts.keep, counts.unlink], [1, 1, 1]);

    const done = await applyStatementDelete(me.client, admin, me.id, s.importId, expectOf(preview.body));
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.deepEqual([done.body.deleted, done.body.kept_with_receipt, done.body.unlinked], [1, 1, 1]);

    // A deleted; its line freed and stamped with what it was
    assert.equal((await admin.from("receipts").select("id").eq("id", s.expenseA)).data!.length, 0);
    const lineA = await lineOf(s.lines[0].id);
    assert.deepEqual([lineA.resolution, lineA.created_receipt_id, lineA.released_from], ["skipped", null, "new_expense"]);
    assert.ok(lineA.released_at);
    // B stays with its receipt, and its line stays linked so a re-import can't duplicate it
    assert.equal((await admin.from("receipts").select("id").eq("id", s.expenseB)).data!.length, 1);
    const lineB = await lineOf(s.lines[1].id);
    assert.deepEqual([lineB.resolution, lineB.created_receipt_id === s.expenseB, lineB.released_at], ["new_expense", true, null]);
    // the matched receipt is untouched; its line is freed
    assert.equal((await admin.from("receipts").select("id").eq("id", s.matchedReceipt.id)).data!.length, 1);
    const lineM = await lineOf(s.lines[2].id);
    assert.deepEqual([lineM.resolution, lineM.matched_receipt_id, lineM.released_from], ["skipped", null, "matched"]);

    // the import is discarded - hidden by default, listed with "Show deleted"
    assert.equal((await loadStatementList(me.client, me.id)).some((i) => i.id === s.importId), false);
    const withDeleted = await loadStatementList(me.client, me.id, { includeDeleted: true });
    assert.equal(withDeleted.find((i) => i.id === s.importId)?.deleted, true);
    assert.ok((await countDeletedStatements(me.client, me.id)) >= 1);
    assert.equal((await previewStatementDelete(me.client, me.id, s.importId)).status, 409, "can't be deleted twice");

    // the same file can be started again
    const again = await admin.rpc("start_statement_import", {
      p_user_id: me.id,
      p_account_id: me.cardId,
      p_file_sha256: s.hash,
      p_page_count: 1,
      p_chunks: [{ page_from: 1, page_to: 1 }],
      p_monthly_cap: null,
    });
    assert.ifError(again.error);
  });

  it("3. stale protection: a receipt attached after the preview changes the plan - nothing is deleted", async (t) => {
    if (skipIfMissing(t)) return;
    const s = await savedImport();
    const preview = await previewStatementDelete(me.client, me.id, s.importId);
    assert.equal((preview.body.plan as { counts: { delete: number } }).counts.delete, 2);
    assert.ifError((await admin.from("receipts").update({ no_receipt: false, tax_amount: 5 }).eq("id", s.expenseA)).error);

    const res = await applyStatementDelete(me.client, admin, me.id, s.importId, expectOf(preview.body));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, "STALE_PREVIEW");
    assert.equal(((res.body.plan as { counts: { delete: number } }).counts).delete, 1, "fresh counts come back");
    for (const id of [s.expenseA, s.expenseB]) {
      assert.equal((await admin.from("receipts").select("id").eq("id", id)).data!.length, 1, "nothing was deleted");
    }
    assert.equal((await admin.from("statement_imports").select("status").eq("id", s.importId).single()).data!.status, "committed");
  });

  it("4. a partly deleted statement: only what still exists is planned, and the deleted one's line remembers what it was", async (t) => {
    if (skipIfMissing(t)) return;
    const s = await savedImport();
    // the owner deletes expense A by hand, through their own session (like the Delete button does)
    assert.ifError((await me.client.from("receipts").delete().eq("id", s.expenseA)).error);
    const lineA = await lineOf(s.lines[0].id);
    assert.deepEqual([lineA.resolution, lineA.released_from], ["skipped", "new_expense"]);

    const list = (await loadStatementList(me.client, me.id)).find((i) => i.id === s.importId)!;
    assert.deepEqual([list.summary.created, list.summary.created_remaining], [2, 1], "created keeps its true total");

    const preview = await previewStatementDelete(me.client, me.id, s.importId);
    assert.equal((preview.body.plan as { counts: { delete: number } }).counts.delete, 1);
    // deleting the matched receipt by hand stamps its line too
    assert.ifError((await me.client.from("receipts").delete().eq("id", s.matchedReceipt.id)).error);
    assert.equal((await lineOf(s.lines[2].id)).released_from, "matched");
  });

  it("5. ALREADY_IMPORTED: counts, what a re-import brings back, retire and restore, and the cap usage", async (t) => {
    if (skipIfMissing(t)) return;
    const s = await savedImport();
    assert.ifError((await me.client.from("receipts").delete().eq("id", s.expenseA)).error);

    const info = (await alreadyImportedFor(me.client, me.id, s.hash, 3))!;
    assert.deepEqual([info.created, info.created_remaining], [2, 1]);
    assert.deepEqual(info.free, { excluded: 1, released: 1, total: 2 }, "the excluded purchase and the freed expense; the payment is never free");
    assert.equal(info.can_reimport, true);
    assert.ok(info.cap.used >= 1);
    assert.equal(info.cap.cap, 3);
    assert.equal(info.cap.used, await monthlyImportUsage(me.client, me.id));

    // retire, then put back when starting fails: nothing vanishes from the list
    assert.equal(await releaseForReimport(admin, me.id, s.importId, s.hash), true);
    assert.equal(await alreadyImportedFor(me.client, me.id, s.hash, 3), null, "no longer the file's committed import");
    assert.equal(await releaseForReimport(admin, me.id, s.importId, s.hash), false, "can't retire it twice");
    await restoreAfterFailedReimport(admin, me.id, s.importId);
    assert.ok(await alreadyImportedFor(me.client, me.id, s.hash, 3), "back as the committed import");

    // a wrong hash can't retire someone else's import
    assert.equal(await releaseForReimport(admin, me.id, s.importId, sha()), false);
    assert.equal(await releaseForReimport(admin, other.id, s.importId, s.hash), false);
  });

  it("6. nothing to bring back: when every line is claimed or a payment, Re-import isn't offered", async (t) => {
    if (skipIfMissing(t)) return;
    const s = await savedImport();
    // the one excluded purchase line is the only free line; make it a payment (payments are never free)
    assert.ifError((await admin.from("statement_lines").update({ kind: "payment" }).eq("id", s.lines[3].id)).error);
    const info = (await alreadyImportedFor(me.client, me.id, s.hash, null))!;
    assert.deepEqual(info.free, { excluded: 0, released: 0, total: 0 });
    assert.equal(info.can_reimport, false);
    assert.equal(info.cap.cap, null, "no cap = unlimited");
  });

  it("7. another owner can't see, preview or delete a statement", async (t) => {
    if (skipIfMissing(t)) return;
    const s = await savedImport();
    assert.equal(await loadStatementDetail(other.client, other.id, s.importId), null);
    assert.equal((await loadStatementList(other.client, other.id)).some((i) => i.id === s.importId), false);
    assert.equal((await previewStatementDelete(other.client, other.id, s.importId)).status, 404);
    const fake: DeleteExpectation = { delete_ids: [s.expenseA], unlink_line_ids: [], keep_ids: [] };
    assert.equal((await applyStatementDelete(other.client, admin, other.id, s.importId, fake)).status, 404);
    assert.equal((await admin.from("receipts").select("id").eq("id", s.expenseA)).data!.length, 1);
    assert.equal(await alreadyImportedFor(other.client, other.id, s.hash, 3), null);
  });

  it("8. an expense links back to its statement, and a deleted statement says so", async (t) => {
    if (skipIfMissing(t)) return;
    const s = await savedImport();
    const link = (await findStatementForReceipt(me.client, me.id, s.expenseA))!;
    assert.deepEqual([link.import_id, link.issuer, link.deleted], [s.importId, "TD", false]);
    assert.ok(await findStatementForReceipt(me.client, me.id, s.matchedReceipt.id), "a matched receipt too");
    assert.equal(await findStatementForReceipt(me.client, me.id, (await ordinaryReceipt(me)).id), null, "an ordinary receipt has none");
    assert.equal(await findStatementForReceipt(other.client, other.id, s.expenseA), null, "another owner sees nothing");
    assert.equal(await findStatementForReceipt(me.client, me.id, "x') or (true"), null, "only a real uuid reaches the filter");
    // after Delete statement, the expense that STAYED (it has a receipt) points at a deleted statement
    assert.ifError((await admin.from("receipts").update({ no_receipt: false, tax_amount: 5 }).eq("id", s.expenseB)).error);
    const preview = await previewStatementDelete(me.client, me.id, s.importId);
    assert.equal((await applyStatementDelete(me.client, admin, me.id, s.importId, expectOf(preview.body))).status, 200);
    assert.equal((await findStatementForReceipt(me.client, me.id, s.expenseB))?.deleted, true);
  });
});
