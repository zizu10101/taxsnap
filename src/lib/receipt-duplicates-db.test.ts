import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "./file-hash.ts";
import { checkExactFile, findDuplicateChecks, findReceiptsByFileHash, findSimilarReceipts } from "./receipt-duplicates-server.ts";

// Duplicate detection against the real database (migration 0056: receipts.file_sha256), as REAL
// SIGNED-IN USERS - the same client the app's routes use, so row-level security is what scopes
// every lookup. A second user is the bystander that proves a hash never matches across owners.
//
// Runs against the REAL project (shared with production), so it is OFF unless
//   RUN_DB_ISOLATION_TEST=1 node --env-file=.env.local --test src/lib/receipt-duplicates-db.test.ts
// and it skips itself until 0056 is applied. It creates two throwaway users and always deletes them,
// verifying nothing is left.

const RUN = process.env.RUN_DB_ISOLATION_TEST === "1";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = `Pw-${randomUUID()}`;

describe("receipt duplicate detection (real database, signed-in users)", { skip: !RUN || !URL_ || !ANON || !SERVICE }, () => {
  let admin: SupabaseClient;
  let hasColumn = false;
  const created: string[] = [];
  interface Person {
    id: string;
    client: SupabaseClient;
  }
  let a: Person;
  let b: Person;

  async function makePerson(label: string): Promise<Person> {
    const email = `receipt-dup-${label}-${randomUUID()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(error);
    created.push(data.user!.id);
    const client = createClient(URL_!, ANON!, { auth: { persistSession: false } });
    assert.ifError((await client.auth.signInWithPassword({ email, password })).error);
    return { id: data.user!.id, client };
  }

  // A receipt saved the way POST /api/receipts saves one (through the owner's own session).
  async function save(p: Person, over: Record<string, unknown> = {}) {
    const res = await p.client
      .from("receipts")
      .insert({ user_id: p.id, merchant_name: "Rogers", transaction_date: "2026-02-08", total_amount: 89.99, tax_category: "Phone", ...over })
      .select("id, file_sha256")
      .single();
    return res;
  }

  const photo = new Uint8Array(2048).map((_, i) => (i * 7) % 251);
  const originalFile = (name: string) => new File([photo as BlobPart], name, { type: "image/jpeg" });
  let hash: string;

  before(async () => {
    admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } });
    hasColumn = !(await admin.from("receipts").select("file_sha256").limit(1)).error;
    if (!hasColumn) return;
    a = await makePerson("a");
    b = await makePerson("b");
    hash = await sha256Hex(originalFile("scan.jpg"));
  });

  after(async () => {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    if (created.length > 0) {
      const { count } = await admin.from("receipts").select("*", { count: "exact", head: true }).in("user_id", created);
      assert.equal(count, 0, "leftover receipts");
    }
  });

  it("1. exact-hash hit: a saved receipt is found again by the hash of its original file", async (t) => {
    if (!hasColumn) return t.skip("migration 0056 is not applied yet");
    const first = await save(a, { file_sha256: hash });
    assert.ifError(first.error);

    const found = await findReceiptsByFileHash(a.client, a.id, hash);
    assert.deepEqual(found.map((r) => r.id), [first.data!.id]);
    assert.deepEqual(
      Object.keys(found[0]).sort(),
      ["id", "merchant_name", "total_amount", "transaction_date"],
      "only the details shown in the warning come back",
    );

    const early = await checkExactFile(a.client, a.id, hash, false);
    assert.equal(early.stop, true, "an exact match stops the scan before any parsing or upload");
  });

  it("2. the same file renamed still hits: the hash is of the bytes, not the name", async (t) => {
    if (!hasColumn) return t.skip("migration 0056 is not applied yet");
    const renamedHash = await sha256Hex(originalFile("IMG_9999 (1).JPG"));
    assert.equal(renamedHash, hash);
    assert.equal((await checkExactFile(a.client, a.id, renamedHash, false)).stop, true);
  });

  it("3. a different file does not hit", async (t) => {
    if (!hasColumn) return t.skip("migration 0056 is not applied yet");
    const other = await sha256Hex(new File([new Uint8Array([9, 9, 9])], "other.jpg"));
    assert.equal((await checkExactFile(a.client, a.id, other, false)).stop, false);
  });

  it("4. a different user's hash never matches - even the very same hash", async (t) => {
    if (!hasColumn) return t.skip("migration 0056 is not applied yet");
    // B has never scanned this file: A's receipt is invisible to them.
    assert.deepEqual(await findReceiptsByFileHash(b.client, b.id, hash), []);
    assert.equal((await checkExactFile(b.client, b.id, hash, false)).stop, false);
    // Asking as B but naming A's id still finds nothing (RLS, not just the filter).
    assert.deepEqual(await findReceiptsByFileHash(b.client, a.id, hash), []);

    // Once B saves the same file themselves, B matches THEIR receipt only.
    const theirs = await save(b, { merchant_name: "B's own", file_sha256: hash });
    assert.ifError(theirs.error);
    const found = await findReceiptsByFileHash(b.client, b.id, hash);
    assert.deepEqual(found.map((r) => r.id), [theirs.data!.id]);
    assert.ok(found.every((r) => r.merchant_name === "B's own"));
    // ...and A's lookup still sees only A's.
    assert.ok((await findReceiptsByFileHash(a.client, a.id, hash)).every((r) => r.merchant_name === "Rogers"));
  });

  it("5. 'Continue anyway' still saves: forcing skips the stop, and a duplicate hash can be stored", async (t) => {
    if (!hasColumn) return t.skip("migration 0056 is not applied yet");
    const forced = await checkExactFile(a.client, a.id, hash, true);
    assert.equal(forced.stop, false, "force=1 never stops");

    // The second save of the same file succeeds - there is no unique constraint to refuse it.
    const second = await save(a, { transaction_date: "2026-02-09", file_sha256: hash });
    assert.ifError(second.error);
    const both = await findReceiptsByFileHash(a.client, a.id, hash);
    assert.equal(both.length, 2);
    assert.equal(both[0].id, second.data!.id, "newest first");
  });

  it("6. no hash (a manual expense) and a malformed hash are never a match, and a malformed one can't be stored", async (t) => {
    if (!hasColumn) return t.skip("migration 0056 is not applied yet");
    assert.equal((await checkExactFile(a.client, a.id, null, false)).stop, false);
    assert.equal((await checkExactFile(a.client, a.id, "not-a-hash", false)).stop, false);
    const manual = await save(a, { merchant_name: "Manual one" });
    assert.ifError(manual.error);
    assert.equal(manual.data!.file_sha256, null);
    assert.equal((await save(a, { file_sha256: "XYZ" })).error?.code, "23514", "the 64-hex check rejects it");
  });

  it("7. a different file with the same merchant, total and date is only a SOFT warning candidate", async (t) => {
    if (!hasColumn) return t.skip("migration 0056 is not applied yet");
    const otherFileHash = await sha256Hex(new File([new Uint8Array([4, 4, 4, 4])], "second-photo.jpg"));
    assert.equal((await checkExactFile(a.client, a.id, otherFileHash, false)).stop, false, "not the same file");
    const similar = await findSimilarReceipts(a.client, a.id, { merchant: "ROGERS", total: 89.99, date: "2026-02-08" });
    assert.ok(similar.length >= 1, "but it looks like the same purchase");
    assert.ok(similar.every((r) => r.merchant_name === "Rogers" && r.total_amount === 89.99));
  });

  it("8. the soft warning's window and exactness hold against real rows", async (t) => {
    if (!hasColumn) return t.skip("migration 0056 is not applied yet");
    const near = (date: string, merchant = "Rogers", total = 89.99) => findSimilarReceipts(a.client, a.id, { merchant, total, date });
    assert.ok((await near("2026-02-10")).length >= 1, "2 days after");
    assert.equal((await near("2026-02-12")).length, 0, "4 days after");
    assert.equal((await near("2026-02-08", "Rogers", 89.98)).length, 0, "a cent off");
    assert.equal((await near("2026-02-08", "Staples")).length, 0, "a different merchant");
    // Another owner never sees A's receipts, even for an identical purchase.
    assert.equal((await findSimilarReceipts(b.client, b.id, { merchant: "Rogers", total: 89.99, date: "2026-02-08" })).length, 0);
  });

  it("10. a statement expense that ALREADY has a receipt is flagged; one still waiting is not; nobody else sees it", async (t) => {
    if (!hasColumn) return t.skip("migration 0056 is not applied yet");
    const asStatement = (over: Record<string, unknown>) =>
      admin
        .from("receipts")
        .insert({
          user_id: a.id, merchant_name: "Rogers", total_amount: 89.99, tax_category: "Phone", from_statement: true,
          ...over,
        })
        .select("id")
        .single();
    const attachedRow = await asStatement({ transaction_date: "2026-02-22", no_receipt: false, receipt_attached_at: new Date().toISOString() });
    const waitingRow = await asStatement({ transaction_date: "2026-02-20", no_receipt: true });
    const closeRow = await asStatement({ transaction_date: "2026-02-09", no_receipt: false, receipt_attached_at: new Date().toISOString() });
    for (const r of [attachedRow, waitingRow, closeRow]) assert.ifError(r.error);

    const scan = { merchant: "Rogers Communications Canada Inc.", total: 89.99, date: "2026-02-08" };
    const checks = await findDuplicateChecks(a.client, a.id, scan);
    const attachedIds = checks.attached.map((r) => r.id);
    assert.ok(attachedIds.includes(attachedRow.data!.id), "the Feb 22 charge (14 days away) already has a receipt");
    assert.ok(attachedIds.includes(closeRow.data!.id));
    assert.ok(!attachedIds.includes(waitingRow.data!.id), "a charge still waiting for its receipt is not 'already attached'");
    assert.ok(checks.attached.every((r) => r.attached_on !== null));
    // The Feb 9 one is also within 2 days, but it is shown once - under the more specific message.
    assert.ok(!checks.similar.some((r) => attachedIds.includes(r.id)), "no receipt appears in both lists");

    const theirs = await findDuplicateChecks(b.client, b.id, scan);
    assert.deepEqual([theirs.similar.length, theirs.attached.length], [0, 0], "another owner sees none of it");
  });

  it("9. deleting a receipt deletes its hash: scanning the file again no longer warns", async (t) => {
    if (!hasColumn) return t.skip("migration 0056 is not applied yet");
    const rows = await findReceiptsByFileHash(a.client, a.id, hash);
    for (const r of rows) assert.ifError((await a.client.from("receipts").delete().eq("id", r.id)).error);
    assert.equal((await checkExactFile(a.client, a.id, hash, false)).stop, false);
  });
});
