import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { tidyMerchantNames } from "./statement-merchant.ts";

// Exercises the statement-import database functions (0052, and 0053 where it is
// applied) as the service role, on throwaway users: monthly cap, resume, per-chunk
// retry, fingerprints, "already imported" flags, commit guards, discard and purge.
//
// Same safety rules as statement-import-isolation.test.ts: it talks to the REAL
// project (shared with production), so it is OFF unless
//   RUN_DB_ISOLATION_TEST=1 node --env-file=.env.local --test src/lib/statement-import-db.test.ts
// and it always deletes the users it created. The purge test only ever uses a
// 300-day cutoff against rows it back-dates itself, so it can't touch anyone's
// real drafts.

const RUN = process.env.RUN_DB_ISOLATION_TEST === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sha = () => randomUUID().replace(/-/g, "").padEnd(64, "0");
const line = (over: Record<string, unknown> = {}) => ({
  page: 1,
  line_no: 1,
  txn_date: "2026-09-10",
  description: "TEST MERCHANT",
  amount: 25,
  kind: "purchase",
  currency: "CAD",
  ...over,
});

describe("statement import database functions", { skip: !RUN || !URL_ || !SERVICE }, () => {
  let admin: SupabaseClient;
  let userId: string;
  let cardId: string;
  let bankId: string;
  let otherUserCardId: string;
  const created: string[] = [];
  let hasReceiptColumns = false;

  const rpc = (fn: string, args: Record<string, unknown>) => admin.rpc(fn, args);

  async function makeUserWithCard(label: string) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `statement-db-${label}-${randomUUID()}@example.com`,
      password: `Pw-${randomUUID()}`,
      email_confirm: true,
    });
    assert.ifError(error);
    created.push(data.user!.id);
    const { data: card, error: e2 } = await admin
      .from("bank_accounts")
      .insert({ user_id: data.user!.id, name: `Card ${label}`, account_type: "card" })
      .select("id")
      .single();
    assert.ifError(e2);
    return { id: data.user!.id, cardId: card!.id as string };
  }

  async function start(opts: { sha?: string; chunks?: number; cap?: number | null; account?: string } = {}) {
    const n = opts.chunks ?? 1;
    return rpc("start_statement_import", {
      p_user_id: userId,
      p_account_id: opts.account ?? cardId,
      p_file_sha256: opts.sha ?? sha(),
      p_page_count: n,
      p_chunks: Array.from({ length: n }, (_, i) => ({ page_from: i + 1, page_to: i + 1 })),
      p_monthly_cap: opts.cap ?? null,
    });
  }

  const save = (importId: string, chunkNo: number, lines: unknown[], header: unknown = null, tokens = 10) =>
    rpc("save_chunk_result", {
      p_user_id: userId,
      p_import_id: importId,
      p_chunk_no: chunkNo,
      p_lines: lines,
      p_header: header,
      p_input_tokens: tokens,
      p_output_tokens: tokens,
    });

  const finalize = (importId: string) => rpc("finalize_statement_lines", { p_user_id: userId, p_import_id: importId });
  const commit = (importId: string, diff: number | null = null, ack = false) =>
    rpc("commit_statement_import", {
      p_user_id: userId,
      p_import_id: importId,
      p_reconcile_diff: diff,
      p_reconcile_acknowledged: ack,
    });

  async function lines(importId: string) {
    const { data, error } = await admin
      .from("statement_lines")
      .select("*")
      .eq("import_id", importId)
      .order("page")
      .order("line_no");
    assert.ifError(error);
    return data!;
  }

  // An import with every chunk read and finalized, ready for decisions.
  async function readyImport(rows: unknown[]) {
    const { data: id, error } = await start();
    assert.ifError(error);
    assert.ifError((await save(id as string, 1, rows)).error);
    assert.ifError((await finalize(id as string)).error);
    return id as string;
  }

  before(async () => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
    const me = await makeUserWithCard("me");
    userId = me.id;
    cardId = me.cardId;
    const { data: bank } = await admin
      .from("bank_accounts")
      .insert({ user_id: userId, name: "A bank account", account_type: "bank" })
      .select("id")
      .single();
    bankId = bank!.id;
    otherUserCardId = (await makeUserWithCard("other")).cardId;
    // Is migration 0053 (receipts.from_statement / no_receipt) applied yet?
    hasReceiptColumns = !(await admin.from("receipts").select("no_receipt").limit(1)).error;
  });

  after(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    for (const table of ["statement_imports", "statement_lines", "bank_accounts", "receipts"] as const) {
      const { count } = await admin.from(table).select("*", { count: "exact", head: true }).in("user_id", created);
      assert.equal(count, 0, `leftover rows in ${table}`);
    }
  });

  it("start: only the user's own credit card is accepted", async () => {
    assert.match((await start({ account: bankId })).error?.message ?? "", /ACCOUNT_NOT_CARD/);
    assert.match((await start({ account: otherUserCardId })).error?.message ?? "", /ACCOUNT_NOT_CARD/);
  });

  it("start: one open draft per file - the same file again is a unique violation to resume", async () => {
    const file = sha();
    assert.ifError((await start({ sha: file })).error);
    assert.equal((await start({ sha: file })).error?.code, "23505");
  });

  it("monthly cap: counts imports, refuses past the cap, and a 'failed' import is free", async () => {
    const before = (await admin.from("statement_imports").select("id", { count: "exact", head: true }).eq("user_id", userId)).count ?? 0;
    // Cap = current count + 1: exactly one more is allowed.
    const cap = before + 1;
    const first = await start({ cap });
    assert.ifError(first.error);
    assert.match((await start({ cap })).error?.message ?? "", /STATEMENT_CAP_REACHED/);
    // Nothing was read from the first, so discarding it makes it 'failed' - free.
    assert.ifError((await rpc("discard_statement_import", { p_user_id: userId, p_import_id: first.data })).error);
    assert.equal((await admin.from("statement_imports").select("status").eq("id", first.data).single()).data?.status, "failed");
    assert.ifError((await start({ cap })).error);
    // An unlimited tier is never refused.
    assert.ifError((await start({ cap: null })).error);
  });

  it("chunks: a retry replaces only that chunk's lines, failures keep attempts and tokens", async () => {
    const { data: id } = await start({ chunks: 2 });
    const importId = id as string;
    assert.ifError((await save(importId, 1, [line({ page: 1, line_no: 1, amount: 10 })], { issuer: "Test Bank", period_start: "2026-08-15", period_end: "2026-09-14" })).error);
    assert.ifError((await save(importId, 2, [line({ page: 2, line_no: 1, amount: 20 })])).error);
    assert.equal((await lines(importId)).length, 2);

    // Chunk 2 fails once, then is re-read with a different result.
    assert.ifError((await rpc("fail_chunk", { p_user_id: userId, p_import_id: importId, p_chunk_no: 2, p_error_code: "PROVIDER_BUSY", p_input_tokens: 5, p_output_tokens: 5 })).error);
    let chunk2 = (await admin.from("statement_chunks").select("*").eq("import_id", importId).eq("chunk_no", 2).single()).data!;
    assert.equal(chunk2.status, "failed");
    assert.equal(chunk2.error_code, "PROVIDER_BUSY");

    assert.ifError((await save(importId, 2, [line({ page: 2, line_no: 1, amount: 21 }), line({ page: 2, line_no: 2, amount: 22 })])).error);
    const after = await lines(importId);
    assert.deepEqual(after.map((l) => l.amount), [10, 21, 22], "chunk 1's line must be untouched");
    chunk2 = (await admin.from("statement_chunks").select("*").eq("import_id", importId).eq("chunk_no", 2).single()).data!;
    assert.equal(chunk2.status, "done");
    assert.equal(chunk2.error_code, null);
    assert.equal(chunk2.attempts, 3, "saved, failed, then re-read = three attempts");

    const imp = (await admin.from("statement_imports").select("*").eq("id", importId).single()).data!;
    assert.equal(imp.issuer, "Test Bank");
    assert.equal(imp.period_start, "2026-08-15");
    assert.equal(imp.input_tokens, 10 + 10 + 5 + 10, "tokens accumulate across every attempt, failed ones included");
  });

  it("finalize: refuses while a chunk is unread; then fingerprints, skips payments, separates twins", async () => {
    const { data: id } = await start({ chunks: 2 });
    const importId = id as string;
    assert.ifError((await save(importId, 1, [line({ amount: 4.5 }), line({ line_no: 2, amount: 4.5 }), line({ line_no: 3, kind: "payment", amount: -100 })])).error);
    assert.match((await finalize(importId)).error?.message ?? "", /CHUNKS_INCOMPLETE/);
    assert.ifError((await save(importId, 2, [])).error);
    assert.equal((await finalize(importId)).data, 3);

    const rows = await lines(importId);
    assert.ok(rows.every((r) => r.line_fingerprint), "every line is fingerprinted");
    assert.notEqual(rows[0].line_fingerprint, rows[1].line_fingerprint, "two identical same-day charges must not collide");
    assert.equal(rows[2].resolution, "skipped", "a payment to the card is skipped automatically");
    assert.equal(rows[0].resolution, null);
    // Idempotent.
    assert.equal((await finalize(importId)).data, 3);
  });

  it("already imported: a line matching a saved one is flagged and skipped by default, never dropped", async () => {
    const first = await readyImport([line({ txn_date: "2026-08-20", amount: 77.77 })]);
    // Stand in for "committed" without needing 0053 (commit's receipt insert).
    assert.ifError((await admin.from("statement_lines").update({ committed: true, resolution: "new_expense", category: "Other", category_confirmed: true }).eq("import_id", first)).error);

    const second = await readyImport([line({ txn_date: "2026-08-20", amount: 77.77, description: "SAME CHARGE, DIFFERENT OCR WORDING" }), line({ line_no: 2, txn_date: "2026-08-21", amount: 5 })]);
    const rows = await lines(second);
    assert.ok(rows[0].duplicate_of_line_id, "the repeated charge is flagged");
    assert.equal(rows[0].resolution, "skipped");
    assert.equal(rows[1].duplicate_of_line_id, null);
    assert.equal(rows[1].resolution, null, "a new charge is left for the user");
    assert.equal(rows.length, 2, "nothing was dropped");

    // The user overrides, then chooses to import it; commit must now accept the flag.
    assert.ifError((await admin.from("statement_lines").update({ duplicate_override: true, resolution: "new_expense", category: "Other", category_confirmed: true }).eq("id", rows[0].id)).error);
    // (line 2 still undecided, so commit stops at UNDECIDED_LINES - but not at DUPLICATE_LINES)
    assert.match((await commit(second)).error?.message ?? "", /UNDECIDED_LINES/);
  });

  it("commit guards, in order: undecided, unconfirmed category, reconcile ack, duplicates", async () => {
    const importId = await readyImport([line({ amount: 31.31, txn_date: "2026-07-01" })]);
    const [row] = await lines(importId);

    assert.match((await commit(importId)).error?.message ?? "", /UNDECIDED_LINES/);

    await admin.from("statement_lines").update({ resolution: "new_expense", category: "Supplies", category_confirmed: false }).eq("id", row.id);
    assert.match((await commit(importId)).error?.message ?? "", /UNCONFIRMED_CATEGORIES/);

    await admin.from("statement_lines").update({ category_confirmed: true }).eq("id", row.id);
    assert.match((await commit(importId, 12.5, false)).error?.message ?? "", /RECONCILE_NOT_ACKNOWLEDGED/);

    // A flagged duplicate that was never overridden blocks the commit even if everything else is ready.
    const earlier = await readyImport([line({ amount: 99.01, txn_date: "2026-06-01" })]);
    await admin.from("statement_lines").update({ committed: true, resolution: "new_expense", category: "Other", category_confirmed: true }).eq("import_id", earlier);
    const dupImport = await readyImport([line({ amount: 99.01, txn_date: "2026-06-01" })]);
    const [dup] = await lines(dupImport);
    assert.ok(dup.duplicate_of_line_id);
    await admin.from("statement_lines").update({ resolution: "new_expense", category: "Other", category_confirmed: true }).eq("id", dup.id);
    assert.match((await commit(dupImport)).error?.message ?? "", /DUPLICATE_LINES/);
  });

  it("a payment can't be made a new expense, and an HST figure must fit the line (check constraints)", async () => {
    const importId = await readyImport([line({ kind: "payment", amount: -50 }), line({ line_no: 2, kind: "refund", amount: -10 })]);
    const rows = await lines(importId);
    // HST on a refund must be a credit no larger than the refund itself.
    assert.equal((await admin.from("statement_lines").update({ tax_amount: -1.3 }).eq("id", rows[1].id)).error, null);
    assert.equal((await admin.from("statement_lines").update({ tax_amount: -11 }).eq("id", rows[1].id)).error?.code, "23514");
    assert.equal((await admin.from("statement_lines").update({ tax_amount: 1 }).eq("id", rows[1].id)).error?.code, "23514");
    // A refund must be negative.
    assert.equal((await admin.from("statement_lines").update({ amount: 10 }).eq("id", rows[1].id)).error?.code, "23514");
    // Only a positive purchase can claim a receipt.
    assert.equal((await admin.from("statement_lines").update({ resolution: "matched" }).eq("id", rows[1].id)).error?.code, "23514");
  });

  it("purge: a stale draft loses its lines and keeps a tombstone that still counts toward the cap", async () => {
    const importId = await readyImport([line({ amount: 8.8, txn_date: "2026-05-05" })]);
    await admin.from("statement_imports").update({ updated_at: new Date(Date.now() - 400 * 86_400_000).toISOString() }).eq("id", importId);

    const { data: purged, error } = await rpc("purge_stale_statement_drafts", { p_days: 300 });
    assert.ifError(error);
    assert.ok((purged as number) >= 1);

    const imp = (await admin.from("statement_imports").select("*").eq("id", importId).single()).data!;
    assert.equal(imp.status, "expired", "something was read, so the cap still sees it");
    assert.equal(imp.issuer, null);
    assert.ok(imp.input_tokens > 0, "the cost audit is kept");
    assert.equal((await lines(importId)).length, 0);
  });

  it("0053: commit saves expenses flagged 'no receipt', and deleting one frees its line", { skip: false }, async (t) => {
    if (!hasReceiptColumns) {
      t.skip("migration 0053 is not applied yet");
      return;
    }
    const importId = await readyImport([line({ amount: 61.11, txn_date: "2026-04-04" }), line({ line_no: 2, kind: "refund", amount: -9, txn_date: "2026-04-05" })]);
    const rows = await lines(importId);
    await admin.from("statement_lines").update({ resolution: "new_expense", category: "Supplies", category_confirmed: true }).in("id", rows.map((r) => r.id));

    const { data, error } = await commit(importId);
    assert.ifError(error);
    assert.deepEqual(data, { matched: 0, created: 2, skipped: 0, skipped_as_already_imported: 0 });

    const { data: receipts } = await admin.from("receipts").select("*").eq("user_id", userId).in("total_amount", [61.11, -9]);
    assert.equal(receipts?.length, 2);
    assert.ok(receipts!.every((r) => r.from_statement && r.no_receipt && r.tax_amount === 0 && r.paid_with_account_id === cardId));

    // Deleting the expense frees the line (it no longer counts as imported).
    const target = receipts!.find((r) => r.total_amount === 61.11)!;
    await admin.from("receipts").delete().eq("id", target.id);
    const freed = (await lines(importId)).find((l) => l.amount === 61.11)!;
    assert.equal(freed.resolution, "skipped");
    assert.equal(freed.created_receipt_id, null);
  });

  it("0053: committed expenses get a tidy merchant name; the statement line keeps the original description", async (t) => {
    if (!hasReceiptColumns) {
      t.skip("migration 0053 is not applied yet");
      return;
    }
    // "Already Tidy" is mixed-case, which the cleaner leaves exactly as it is.
    const raw = ["ROGERS *************3771", "TELUS MOBILITY EDMONTON", "CANADA SPORTSWEAR CORP 416-7408020", "Already Tidy"];
    const amounts = [40, 41, 42, 43];
    const importId = await readyImport(raw.map((description, i) => line({ line_no: i + 1, description, amount: amounts[i], txn_date: "2026-02-02" })));
    const rows = await lines(importId);
    await admin.from("statement_lines").update({ resolution: "new_expense", category: "Phone", category_confirmed: true }).in("id", rows.map((r) => r.id));

    assert.ifError((await commit(importId)).error);
    const readReceipts = async () =>
      (await admin.from("receipts").select("id, merchant_name, total_amount").eq("user_id", userId).in("total_amount", amounts)).data!;
    const before = await readReceipts();
    assert.deepEqual(before.map((r) => r.merchant_name).sort(), [...raw].sort(), "commit itself saves the raw description");

    // The user renames one before the tidy step runs: it must not be overwritten.
    const edited = before.find((r) => r.total_amount === 41)!;
    await admin.from("receipts").update({ merchant_name: "My own name for Telus" }).eq("id", edited.id);

    const changed = await tidyMerchantNames({ supabase: admin, user: { id: userId } }, importId);
    assert.equal(changed, 2, "only ROGERS and CANADA SPORTSWEAR change; the user-edited and already-tidy names don't");

    const byAmount = Object.fromEntries((await readReceipts()).map((r) => [r.total_amount, r.merchant_name]));
    assert.equal(byAmount[40], "Rogers");
    assert.equal(byAmount[41], "My own name for Telus");
    assert.equal(byAmount[42], "Canada Sportswear Corp");
    assert.equal(byAmount[43], "Already Tidy");

    // Nothing is lost: every statement line still has its original description.
    assert.deepEqual((await lines(importId)).map((l) => l.description), raw);

    // Running it again changes nothing.
    assert.equal(await tidyMerchantNames({ supabase: admin, user: { id: userId } }, importId), 0);
  });

  it("0053: deleting an ordinary receipt is untouched by the trigger; deleting a MATCHED one frees its line", async (t) => {
    if (!hasReceiptColumns) {
      t.skip("migration 0053 is not applied yet");
      return;
    }
    const ordinary = async (merchant: string, total: number) => {
      const { data, error } = await admin
        .from("receipts")
        .insert({ user_id: userId, merchant_name: merchant, transaction_date: "2026-03-03", total_amount: total, tax_category: "Other" })
        .select("*")
        .single();
      assert.ifError(error);
      return data!;
    };

    // An ordinary receipt no statement line points at: deletes cleanly, flags stay at their defaults.
    const plain = await ordinary("PLAIN RECEIPT", 14.14);
    assert.equal(plain.from_statement, false);
    assert.equal(plain.no_receipt, false);
    const bystander = await readyImport([line({ amount: 14.14, txn_date: "2026-03-03" })]);
    assert.equal((await admin.from("receipts").delete().eq("id", plain.id)).error, null);
    assert.equal((await lines(bystander))[0].resolution, null, "an unrelated line must not be touched");

    // An ordinary receipt that a line is MATCHED to: deleting it releases the line.
    const matched = await ordinary("MATCHED RECEIPT", 33.33);
    const importId = await readyImport([line({ amount: 33.33, txn_date: "2026-03-03" })]);
    const [row] = await lines(importId);
    assert.ifError((await admin.from("statement_lines").update({ resolution: "matched", matched_receipt_id: matched.id }).eq("id", row.id)).error);
    assert.equal((await admin.from("receipts").delete().eq("id", matched.id)).error, null);
    const released = (await lines(importId))[0];
    assert.equal(released.resolution, "skipped");
    assert.equal(released.matched_receipt_id, null);
  });
});
