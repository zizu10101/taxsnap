import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BULK_DELETE_MAX,
  DELETE_FAILED_REASON,
  NOT_FOUND_REASON,
  cleanBatchId,
  cleanDeleteIds,
  deleteTotals,
  planBulkDelete,
  summarizeBatches,
  type DeleteRow,
} from "./bulk-delete.ts";
import { handleBulkDelete, handleListImports } from "./bulk-delete-server.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BATCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BATCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// ---- the pure rules -----------------------------------------------------------------------------

test("ids: uuids only, no repeats, between 1 and 500", () => {
  assert.deepEqual(cleanDeleteIds([uuid(1), uuid(2)]), [uuid(1), uuid(2)]);
  assert.equal(BULK_DELETE_MAX, 500);
  assert.equal(cleanDeleteIds([]), null);
  assert.equal(cleanDeleteIds([uuid(1), uuid(1)]), null);
  assert.equal(cleanDeleteIds(["nope"]), null);
  assert.equal(cleanDeleteIds("x"), null);
  assert.equal(cleanDeleteIds(Array.from({ length: 501 }, (_, i) => uuid(i + 1))), null);
  assert.equal(cleanDeleteIds(Array.from({ length: 500 }, (_, i) => uuid(i + 1)))?.length, 500);
  assert.equal(cleanBatchId(BATCH_A.toUpperCase()), BATCH_A);
  for (const bad of ["", "x", 5, null, `${BATCH_A}0`]) assert.equal(cleanBatchId(bad), null);
});

test("the confirmation's totals: how many, total amount, total tax (signed, to the cent)", () => {
  assert.deepEqual(deleteTotals([]), { count: 0, total: 0, tax: 0 });
  assert.deepEqual(
    deleteTotals([
      { total_amount: 113, tax_amount: 13 },
      { total_amount: 56.5, tax_amount: 6.5 },
      { total_amount: -22.6, tax_amount: -2.6 },
    ]),
    { count: 3, total: 146.9, tax: 16.9 },
  );
  assert.deepEqual(deleteTotals([{ total_amount: 0.1, tax_amount: 0.01 }, { total_amount: 0.2, tax_amount: 0.02 }]), { count: 2, total: 0.3, tax: 0.03 });
});

const row = (n: number, over: Partial<DeleteRow> = {}): DeleteRow => ({
  id: uuid(n),
  merchant_name: `M${n}`,
  transaction_date: "2026-03-01",
  total_amount: 10 * n,
  tax_amount: n,
  image_url: null,
  ...over,
});

test("a requested id with no row (deleted, or not this owner's) is skipped with the reason; the rest are deleted", () => {
  const plan = planBulkDelete([uuid(1), uuid(2), uuid(3)], [row(1), row(3)]);
  assert.deepEqual(plan.toDelete.map((r) => r.id), [uuid(1), uuid(3)]);
  assert.deepEqual(plan.skipped, [{ id: uuid(2), reason: NOT_FOUND_REASON }]);
});

test("recent imports: one entry per batch, newest first, with rows and totals; rows without a batch are ignored", () => {
  const rows = [
    { import_batch_id: BATCH_A, created_at: "2026-03-01T10:00:00Z", total_amount: 100, tax_amount: 11.5 },
    { import_batch_id: BATCH_A, created_at: "2026-03-01T10:00:02Z", total_amount: 50.25, tax_amount: 0 },
    { import_batch_id: BATCH_B, created_at: "2026-03-05T09:00:00Z", total_amount: 20, tax_amount: 2 },
    { import_batch_id: null, created_at: "2026-03-09T09:00:00Z", total_amount: 999, tax_amount: 99 },
  ];
  assert.deepEqual(summarizeBatches(rows), [
    { id: BATCH_B, imported_at: "2026-03-05T09:00:00Z", rows: 1, total: 20, tax: 2 },
    { id: BATCH_A, imported_at: "2026-03-01T10:00:00Z", rows: 2, total: 150.25, tax: 11.5 },
  ]);
  assert.equal(summarizeBatches(rows, 1).length, 1);
  assert.deepEqual(summarizeBatches([]), []);
});

// ---- a stand-in database for the handler ---------------------------------------------------------

type Row = Record<string, unknown>;
function makeDb(
  initial: Row[],
  opts: { refuseDelete?: (r: Row) => boolean; missingColumn?: string; storageFails?: boolean } = {},
) {
  const receipts = initial.map((r) => ({ ...r }));
  const log = { deleteCalls: [] as number[], removed: [] as string[][] };
  const db = {
    from(table: string) {
      assert.equal(table, "receipts");
      let op: "select" | "delete" = "select";
      const filters: { col: string; test: (r: Row) => boolean }[] = [];
      let range: [number, number] | null = null;
      let limit: number | null = null;
      let missing = false;
      const note = (col: string, test: (r: Row) => boolean) => {
        if (col === opts.missingColumn) missing = true;
        filters.push({ col, test });
      };
      const b = {
        select: () => b,
        delete: () => ((op = "delete"), b),
        eq: (c: string, v: unknown) => (note(c, (r) => r[c] === v), b),
        in: (c: string, v: unknown[]) => (note(c, (r) => v.includes(r[c])), b),
        not: (c: string) => (note(c, (r) => r[c] != null), b),
        order: () => b,
        range: (a: number, z: number) => ((range = [a, z]), b),
        limit: (n: number) => ((limit = n), b),
        then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
          if (missing) return resolve({ data: null, error: { code: "PGRST204", message: "no such column" } });
          let found = receipts.filter((r) => filters.every((f) => f.test(r)));
          if (op === "delete") {
            log.deleteCalls.push(found.length);
            if (opts.refuseDelete && found.some(opts.refuseDelete)) {
              return resolve({ data: null, error: { message: "refused" } });
            }
            for (const r of found) receipts.splice(receipts.indexOf(r), 1);
            return resolve({ data: found.map((r) => ({ id: r.id })), error: null });
          }
          if (range) found = found.slice(range[0], range[1] + 1);
          if (limit !== null) found = found.slice(0, limit);
          return resolve({ data: found, error: null });
        },
      };
      return b;
    },
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          log.removed.push(paths);
          return { error: opts.storageFails ? { message: "storage down" } : null };
        },
      }),
    },
  };
  return { db: db as unknown as Parameters<typeof handleBulkDelete>[0], receipts, log };
}

const mine = (n: number, over: Row = {}): Row => ({
  id: uuid(n),
  user_id: "u1",
  merchant_name: `M${n}`,
  transaction_date: "2026-03-01",
  total_amount: 10 * n,
  tax_amount: n,
  image_url: null,
  from_statement: false,
  import_batch_id: null,
  created_at: "2026-03-01T10:00:00Z",
  ...over,
});

const ids = (rows: Row[]) => rows.map((r) => r.id as string);

// ---- A: bulk delete ----------------------------------------------------------------------------------

test("bulk delete only touches the owner's rows: another owner's row, named by id, is skipped and stays", async () => {
  const { db, receipts } = makeDb([mine(1), mine(2), mine(3, { user_id: "u2" })]);
  const r = await handleBulkDelete(db, "u1", { mode: "apply", ids: [uuid(1), uuid(2), uuid(3)] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.deleted, r.body.deleted_ids], [2, [uuid(1), uuid(2)]]);
  assert.deepEqual(r.body.skipped, [{ id: uuid(3), reason: NOT_FOUND_REASON }]);
  assert.deepEqual(ids(receipts), [uuid(3)], "the other owner's expense is untouched");
});

test("preview: count, total and tax of what would go, the skipped rows with reasons, and nothing is deleted", async () => {
  const { db, receipts, log } = makeDb([mine(1), mine(2), mine(3, { user_id: "u2" })]);
  const r = await handleBulkDelete(db, "u1", { mode: "preview", ids: [uuid(1), uuid(2), uuid(3), uuid(9)] });
  assert.deepEqual([r.body.count, r.body.total, r.body.tax], [2, 30, 3]);
  assert.deepEqual(r.body.skipped, [
    { id: uuid(3), reason: NOT_FOUND_REASON },
    { id: uuid(9), reason: NOT_FOUND_REASON },
  ]);
  assert.equal(receipts.length, 3);
  assert.deepEqual(log.deleteCalls, []);
});

test("rows the database refuses to delete are skipped with the reason, and the rest are still deleted", async () => {
  const { db, receipts } = makeDb([mine(1), mine(2, { locked: true }), mine(3)], { refuseDelete: (r) => r.locked === true });
  const r = await handleBulkDelete(db, "u1", { mode: "apply", ids: [uuid(1), uuid(2), uuid(3)] });
  assert.deepEqual(r.body.deleted_ids, [uuid(1), uuid(3)]);
  assert.deepEqual(r.body.skipped, [{ id: uuid(2), reason: DELETE_FAILED_REASON }]);
  assert.deepEqual(ids(receipts), [uuid(2)]);
});

test("the single delete's rules, no more and no fewer: statement-created and automatic Stripe expenses ARE deletable (the database frees their statement line)", async () => {
  const { db, receipts } = makeDb([
    mine(1, { from_statement: true, no_receipt: true }),
    mine(2, { origin: "stripe" }),
    mine(3, { from_statement: true, no_receipt: false, image_url: "u1/scan.jpg" }),
  ]);
  const r = await handleBulkDelete(db, "u1", { mode: "apply", ids: [uuid(1), uuid(2), uuid(3)] });
  assert.equal(r.body.deleted, 3);
  assert.equal(receipts.length, 0);
  // and the route does what DELETE /api/receipts/[id] does, nothing it doesn't: no extra blocking rule is invented
  const single = read("../app/api/receipts/[id]/route.ts");
  assert.doesNotMatch(single.slice(single.indexOf("export async function DELETE")), /from_statement|no_receipt|\borigin\b|locked|subscription_status/);
  const bulk = read("./bulk-delete-server.ts");
  assert.doesNotMatch(bulk.replace(/\/\/.*$/gm, ""), /from_statement|origin|locked/);
});

test("photos are removed with the expenses, owner's folder only; a failed removal is counted and the expenses are still gone", async () => {
  const rows = [
    mine(1, { image_url: "u1/a.jpg" }),
    mine(2, { image_url: "u2/stolen.jpg" }),
    mine(3, { image_url: "u1/../u2/x.jpg" }),
    mine(4),
  ];
  const a = makeDb(rows);
  const r = await handleBulkDelete(a.db, "u1", { mode: "apply", ids: [uuid(1), uuid(2), uuid(3), uuid(4)] });
  assert.equal(r.body.deleted, 4);
  assert.deepEqual(a.log.removed, [["u1/a.jpg"]], "only a path inside the owner's own folder, and none with ..");
  assert.equal(r.body.files_left, 0);

  const b = makeDb([mine(1, { image_url: "u1/a.jpg" })], { storageFails: true });
  const f = await handleBulkDelete(b.db, "u1", { mode: "apply", ids: [uuid(1)] });
  assert.deepEqual([f.body.deleted, f.body.files_left], [1, 1]);
  assert.equal(b.receipts.length, 0);
});

test("deletes are batched (100 at a time)", async () => {
  const rows = Array.from({ length: 250 }, (_, i) => mine(i + 1));
  const { db, receipts, log } = makeDb(rows);
  const r = await handleBulkDelete(db, "u1", { mode: "apply", ids: rows.map((x) => x.id as string) });
  assert.equal(r.body.deleted, 250);
  assert.deepEqual(log.deleteCalls, [100, 100, 50]);
  assert.equal(receipts.length, 0);
});

test("the server re-validates the request: bad ids, too many, both or neither of ids and an import, bad mode", async () => {
  const { db, receipts } = makeDb([mine(1)]);
  const bad: unknown[] = [
    { mode: "apply", ids: [] },
    { mode: "apply", ids: ["x"] },
    { mode: "apply", ids: [uuid(1), uuid(1)] },
    { mode: "apply", ids: Array.from({ length: 501 }, (_, i) => uuid(i + 1)) },
    { mode: "apply" },
    { mode: "apply", ids: [uuid(1)], import_batch_id: BATCH_A },
    { mode: "apply", import_batch_id: "nope" },
    { mode: "explode", ids: [uuid(1)] },
    null,
    "ids",
  ];
  for (const body of bad) assert.equal((await handleBulkDelete(db, "u1", body)).status, 400, JSON.stringify(body)?.slice(0, 60));
  assert.equal(receipts.length, 1, "nothing was deleted");
});

test("what the confirmation showed is checked at delete time: if the rows changed, nothing is deleted (409)", async () => {
  const { db, receipts } = makeDb([mine(1), mine(2)]);
  const preview = await handleBulkDelete(db, "u1", { mode: "preview", ids: [uuid(1), uuid(2)] });
  const expected = { expected_count: preview.body.count, expected_total_cents: Math.round((preview.body.total as number) * 100) };

  receipts[1].total_amount = 999; // edited after the preview
  const stale = await handleBulkDelete(db, "u1", { mode: "apply", ids: [uuid(1), uuid(2)], ...expected });
  assert.deepEqual([stale.status, stale.body.code], [409, "STALE_PREVIEW"]);
  assert.equal(receipts.length, 2);

  const fewer = await handleBulkDelete(db, "u1", { mode: "apply", ids: [uuid(1), uuid(2)], expected_count: 5 });
  assert.equal(fewer.status, 409);

  receipts[1].total_amount = 20;
  const ok = await handleBulkDelete(db, "u1", { mode: "apply", ids: [uuid(1), uuid(2)], ...expected });
  assert.deepEqual([ok.status, ok.body.deleted], [200, 2]);
});

test("a client's claims about the rows are never used: only ids are read from the request", async () => {
  const { db, receipts } = makeDb([mine(1, { total_amount: 50, tax_amount: 5 })]);
  const r = await handleBulkDelete(db, "u1", {
    mode: "preview",
    ids: [uuid(1)],
    rows: [{ id: uuid(1), total_amount: 1, tax_amount: 1 }],
    total: 1,
    user_id: "u2",
  });
  assert.deepEqual([r.body.count, r.body.total, r.body.tax], [1, 50, 5]);
  assert.equal(receipts.length, 1);
  const other = await handleBulkDelete(db, "u2", { mode: "preview", ids: [uuid(1)] });
  assert.equal(other.body.count, 0, "the session's user id decides, not the body's");
});

test("every receipts query in the handler is scoped to the session's user", () => {
  const src = read("./bulk-delete-server.ts");
  const code = src.replace(/\/\/.*$/gm, "");
  const queries = code.match(/\bdb\s*\.from\("receipts"\)/g) ?? [];
  const scoped = code.match(/\.eq\("user_id", userId\)/g) ?? [];
  assert.ok(queries.length >= 5);
  assert.equal(scoped.length, queries.length, "each query filters on user_id");
});

// ---- B: delete a whole import ----------------------------------------------------------------------

const imported = (n: number, batch: string | null, over: Row = {}) => mine(n, { import_batch_id: batch, ...over });

test("deleting an import deletes only that import: not the other import, not manual expenses, not another owner's copy of the id", async () => {
  const { db, receipts } = makeDb([
    imported(1, BATCH_A),
    imported(2, BATCH_A),
    imported(3, BATCH_B),
    mine(4),
    imported(5, BATCH_A, { user_id: "u2" }),
  ]);
  const r = await handleBulkDelete(db, "u1", { mode: "apply", import_batch_id: BATCH_A });
  assert.deepEqual([r.status, r.body.deleted, r.body.deleted_ids], [200, 2, [uuid(1), uuid(2)]]);
  assert.deepEqual(ids(receipts).sort(), [uuid(3), uuid(4), uuid(5)].sort());
});

test("the import confirmation shows that import's own count, total and tax", async () => {
  const { db, receipts } = makeDb([imported(1, BATCH_A), imported(2, BATCH_A), imported(3, BATCH_B)]);
  const r = await handleBulkDelete(db, "u1", { mode: "preview", import_batch_id: BATCH_A });
  assert.deepEqual([r.body.count, r.body.total, r.body.tax], [2, 30, 3]);
  assert.equal(receipts.length, 3);
  const none = await handleBulkDelete(db, "u1", { mode: "apply", import_batch_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  assert.deepEqual([none.status, none.body.deleted], [200, 0]);
});

test("an import deleted with the same rules: refused rows are skipped with the reason, the rest go", async () => {
  const { db, receipts } = makeDb([imported(1, BATCH_A), imported(2, BATCH_A, { locked: true }), imported(3, BATCH_A)], {
    refuseDelete: (r) => r.locked === true,
  });
  const r = await handleBulkDelete(db, "u1", { mode: "apply", import_batch_id: BATCH_A });
  assert.deepEqual([r.body.deleted, r.body.skipped], [2, [{ id: uuid(2), reason: DELETE_FAILED_REASON }]]);
  assert.deepEqual(ids(receipts), [uuid(2)]);
});

test("before migration 0074 there is no batch column: deleting or listing an import answers 'unavailable', never an error page", async () => {
  const { db, receipts } = makeDb([mine(1)], { missingColumn: "import_batch_id" });
  const r = await handleBulkDelete(db, "u1", { mode: "apply", import_batch_id: BATCH_A });
  assert.deepEqual([r.status, r.body.code], [400, "IMPORTS_UNAVAILABLE"]);
  assert.equal(receipts.length, 1);
  const list = await handleListImports(db, "u1");
  assert.deepEqual([list.status, list.body.available, list.body.batches], [200, false, []]);
});

test("the list of imports: the signed-in owner's batches only, with rows and totals", async () => {
  const { db } = makeDb([
    imported(1, BATCH_A, { created_at: "2026-03-01T10:00:00Z" }),
    imported(2, BATCH_A, { created_at: "2026-03-01T10:00:01Z" }),
    imported(3, BATCH_B, { created_at: "2026-03-07T10:00:00Z" }),
    mine(4),
    imported(5, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", { user_id: "u2" }),
  ]);
  const list = await handleListImports(db, "u1");
  assert.equal(list.body.available, true);
  assert.deepEqual(
    (list.body.batches as { id: string; rows: number; total: number }[]).map((b) => [b.id, b.rows, b.total]),
    [[BATCH_B, 1, 30], [BATCH_A, 2, 30]],
  );
});

// ---- the screen ------------------------------------------------------------------------------------

test("the Expenses tab: Delete on the selection bar, an Imports entry, the import view, and one confirmation for both", () => {
  const controls = read("../components/dashboard/bulk-category-controls.tsx");
  assert.match(controls, /onClick=\{\(\) => onDelete\(selectedIds\)\}/);
  assert.match(controls, /Delete\.\.\./);

  const body = read("../components/dashboard/expenses-body.tsx");
  assert.match(body, /Imports\s*<\/Button>/);
  assert.match(body, /Delete this import/);
  assert.match(body, /<BulkDeleteDialog/);
  assert.match(body, /openDelete\(\{ kind: "ids", ids \}\)/);
  assert.match(body, /openDelete\(\{ kind: "batch"/);
  // choosing an import shows that import whatever the date range is
  assert.match(body, /batchFilter \? receipts\.filter\(\(r\) => r\.import_batch_id === batchFilter\.id\) : filterByRange\(receipts, range\)/);

  const dialog = read("../components/dashboard/bulk-delete-dialog.tsx");
  assert.match(dialog, /This can&apos;t be undone/);
  assert.match(dialog, /expected_count: preview\.count/);
  assert.match(dialog, /money\(preview\.total\)/);
  assert.match(dialog, /money\(preview\.tax\)/);
  assert.match(dialog, /can&apos;t be deleted and will be skipped/);
});

test("the migration: a nullable column and a partial index, no grants, and a rollback", () => {
  const sql = read("../../supabase/migrations/0074_receipt_import_batch.sql");
  const code = sql.replace(/--.*$/gm, "");
  assert.match(code, /add column import_batch_id uuid;/);
  assert.match(code, /create index receipts_user_import_batch_idx\s+on public\.receipts \(user_id, import_batch_id\)\s+where import_batch_id is not null;/);
  assert.doesNotMatch(code.replace("where import_batch_id is not null", ""), /\bgrant\b|\brevoke\b|\bnot null\b|\bdefault\b|\bunique\b|\breferences\b/i);
  const rollback = read("../../supabase/rollbacks/0074_receipt_import_batch_rollback.sql");
  assert.match(rollback, /drop index if exists public\.receipts_user_import_batch_idx;/);
  assert.match(rollback, /drop column if exists import_batch_id;/);
});
