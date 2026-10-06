import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Two-user isolation test for card-statement import (migration 0052): proves one
// signed-in user cannot read - or write - another's imports, chunks or lines,
// that nobody can write these tables at all except through the service role, and
// that the service-role functions can't be called by a signed-in user.
//
// It runs against the REAL Supabase project, and local dev shares that project
// with production (see CLAUDE.md). So it is OFF by default and only runs with
//   RUN_DB_ISOLATION_TEST=1 node --env-file=.env.local --test src/lib/statement-import-isolation.test.ts
// It creates two throwaway auth users with unguessable emails, and always deletes
// both (and verifies their rows are gone) in `after`, whether or not it passed.

const RUN = process.env.RUN_DB_ISOLATION_TEST === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

interface TestUser {
  id: string;
  client: SupabaseClient;
  importId: string;
  cardId: string;
}

const password = `Iso-${randomUUID()}`;
const emailFor = (label: string) => `statement-isolation-${label}-${randomUUID()}@example.com`;

describe("statement import isolation (two users)", { skip: !RUN || !URL_ || !ANON || !SERVICE }, () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let a: TestUser;
  let b: TestUser;
  const createdUserIds: string[] = [];

  async function makeUser(label: string): Promise<TestUser> {
    const email = emailFor(label);
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    const id = data.user!.id;
    createdUserIds.push(id);

    const { data: card, error: cardErr } = await admin
      .from("bank_accounts")
      .insert({ user_id: id, name: `Isolation card ${label}`, account_type: "card" })
      .select("id")
      .single();
    assert.ifError(cardErr);

    const { data: importId, error: startErr } = await admin.rpc("start_statement_import", {
      p_user_id: id,
      p_account_id: card!.id,
      p_file_sha256: randomUUID().replace(/-/g, "").padEnd(64, "0"),
      p_page_count: 1,
      p_chunks: [{ page_from: 1, page_to: 1 }],
      p_monthly_cap: null,
    });
    assert.ifError(startErr);

    const { error: saveErr } = await admin.rpc("save_chunk_result", {
      p_user_id: id,
      p_import_id: importId,
      p_chunk_no: 1,
      p_lines: [
        {
          page: 1,
          line_no: 1,
          txn_date: "2026-09-10",
          description: `ISOLATION ${label}`,
          amount: 12.34,
          kind: "purchase",
          currency: "CAD",
        },
      ],
      p_header: { issuer: `Issuer ${label}` },
      p_input_tokens: 1,
      p_output_tokens: 1,
    });
    assert.ifError(saveErr);

    const client = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
    assert.ifError(signInErr);

    return { id, client, importId: importId as string, cardId: card!.id };
  }

  before(async () => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
    anon = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    a = await makeUser("a");
    b = await makeUser("b");
  });

  after(async () => {
    // Always remove both users, then prove nothing of theirs is left behind.
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    if (createdUserIds.length > 0) {
      for (const table of ["statement_imports", "statement_chunks", "statement_lines", "bank_accounts", "profiles"] as const) {
        const col = table === "profiles" ? "id" : "user_id";
        const { count } = await admin
          .from(table)
          .select("*", { count: "exact", head: true })
          .in(col, createdUserIds);
        assert.equal(count, 0, `leftover rows in ${table} after cleanup`);
      }
    }
  });

  it("each user can read their own import, chunks and lines (so the checks below aren't vacuous)", async () => {
    for (const u of [a, b]) {
      const imp = await u.client.from("statement_imports").select("id, user_id").eq("id", u.importId);
      assert.ifError(imp.error);
      assert.equal(imp.data?.length, 1);
      const chunks = await u.client.from("statement_chunks").select("id").eq("import_id", u.importId);
      assert.equal(chunks.data?.length, 1);
      const lines = await u.client.from("statement_lines").select("id").eq("import_id", u.importId);
      assert.equal(lines.data?.length, 1);
    }
  });

  it("B cannot read A's import, chunks or lines - by id, by filter, or in a full table read", async () => {
    const byId = await b.client.from("statement_imports").select("*").eq("id", a.importId);
    assert.deepEqual(byId.data, []);

    const chunksByImport = await b.client.from("statement_chunks").select("*").eq("import_id", a.importId);
    assert.deepEqual(chunksByImport.data, []);

    const linesByImport = await b.client.from("statement_lines").select("*").eq("import_id", a.importId);
    assert.deepEqual(linesByImport.data, []);

    // An unfiltered read returns only B's own rows, never A's.
    for (const table of ["statement_imports", "statement_chunks", "statement_lines"] as const) {
      const all = await b.client.from(table).select("user_id");
      assert.ifError(all.error);
      assert.ok(all.data!.length >= 1);
      assert.ok(all.data!.every((r) => r.user_id === b.id), `${table}: B saw another user's row`);
    }
  });

  it("A cannot read B's rows either (the check is symmetric)", async () => {
    const res = await a.client.from("statement_imports").select("*").eq("id", b.importId);
    assert.deepEqual(res.data, []);
  });

  it("a signed-out client can read nothing", async () => {
    for (const table of ["statement_imports", "statement_chunks", "statement_lines"] as const) {
      const res = await anon.from(table).select("*");
      // Either refused outright (no privilege) or an empty result - never data.
      assert.ok(res.error || (res.data ?? []).length === 0, `${table}: anon got rows`);
    }
  });

  it("an owner cannot write these tables at all - not A's rows, not even their own", async () => {
    const lineA = await admin.from("statement_lines").select("id").eq("import_id", a.importId).single();
    const lineB = await admin.from("statement_lines").select("id").eq("import_id", b.importId).single();

    // Insert
    const ins = await b.client.from("statement_imports").insert({
      user_id: b.id,
      account_id: b.cardId,
      file_sha256: "f".repeat(64),
      page_count: 1,
    } as never);
    assert.ok(ins.error, "owner insert into statement_imports should be refused");

    // Update (A's row, then B's own row)
    for (const [table, id] of [
      ["statement_imports", a.importId],
      ["statement_imports", b.importId],
      ["statement_lines", lineA.data!.id],
      ["statement_lines", lineB.data!.id],
    ] as const) {
      const upd = await b.client
        .from(table)
        .update(table === "statement_imports" ? { status: "committed" } : { resolution: "skipped" })
        .eq("id", id)
        .select();
      assert.ok(upd.error || (upd.data ?? []).length === 0, `${table} ${id}: update was not refused`);
    }

    // Delete
    for (const [table, id] of [
      ["statement_imports", a.importId],
      ["statement_lines", lineA.data!.id],
    ] as const) {
      const del = await b.client.from(table).delete().eq("id", id).select();
      assert.ok(del.error || (del.data ?? []).length === 0, `${table} ${id}: delete was not refused`);
    }

    // And nothing actually changed.
    const aImport = await admin.from("statement_imports").select("status").eq("id", a.importId).single();
    assert.equal(aImport.data?.status, "draft");
    const bImport = await admin.from("statement_imports").select("status").eq("id", b.importId).single();
    assert.equal(bImport.data?.status, "draft");
    const aLines = await admin.from("statement_lines").select("resolution").eq("import_id", a.importId);
    assert.equal(aLines.data?.length, 1);
    assert.equal(aLines.data?.[0].resolution, null);
  });

  it("a signed-in user cannot call the service-role functions, even naming another user", async () => {
    const calls = [
      b.client.rpc("start_statement_import", {
        p_user_id: a.id,
        p_account_id: a.cardId,
        p_file_sha256: "e".repeat(64),
        p_page_count: 1,
        p_chunks: [{ page_from: 1, page_to: 1 }],
        p_monthly_cap: null,
      }),
      b.client.rpc("commit_statement_import", {
        p_user_id: a.id,
        p_import_id: a.importId,
        p_reconcile_diff: null,
        p_reconcile_acknowledged: false,
      }),
      b.client.rpc("discard_statement_import", { p_user_id: a.id, p_import_id: a.importId }),
      b.client.rpc("finalize_statement_lines", { p_user_id: a.id, p_import_id: a.importId }),
      // The one that would affect every user's drafts at once.
      b.client.rpc("purge_stale_statement_drafts", { p_days: 0 }),
      anon.rpc("purge_stale_statement_drafts", { p_days: 0 }),
    ];
    for (const res of await Promise.all(calls)) {
      assert.ok(res.error, "function call should be refused");
      assert.equal(res.error.code, "42501", `expected permission denied, got ${res.error.code}: ${res.error.message}`);
    }
    const still = await admin.from("statement_imports").select("status").eq("id", a.importId).single();
    assert.equal(still.data?.status, "draft");
  });
});
