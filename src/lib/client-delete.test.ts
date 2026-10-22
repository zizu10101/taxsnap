import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { blockedMessage, describeReferences } from "./client-delete.ts";
import { handleClientDelete } from "./client-delete-server.ts";
import { wouldExceedTotalLimit } from "./plan-limits.ts";

// A tiny in-memory stand-in for the Supabase query builder: just the shapes the delete handler and the
// plan-cap check use (select / count head / eq / maybeSingle / single / delete). Rows are plain objects.
type Row = Record<string, unknown>;
function fakeDb(tables: Record<string, Row[]>) {
  function from(name: string) {
    const rows = tables[name] ?? (tables[name] = []);
    const filters: [string, unknown][] = [];
    let mode: "select" | "delete" = "select";
    let head = false;
    const match = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
    const run = () => {
      const found = match();
      if (mode === "delete") {
        for (const r of found) rows.splice(rows.indexOf(r), 1);
        return { data: found, error: null, count: null };
      }
      return head ? { data: null, error: null, count: found.length } : { data: found, error: null, count: found.length };
    };
    const q: Record<string, unknown> = {
      select(_cols?: string, opts?: { head?: boolean }) {
        if (opts?.head) head = true;
        return q;
      },
      delete() {
        mode = "delete";
        return q;
      },
      eq(k: string, v: unknown) {
        filters.push([k, v]);
        return q;
      },
      maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
      single: async () => ({ data: match()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return q;
  }
  return { from } as never;
}

const ME = "user-me";
const OTHER = "user-other";

function world(extra: Partial<Record<string, Row[]>> = {}) {
  return {
    profiles: [{ id: ME, subscription_status: "free" }],
    clients: [
      { id: "c-empty", user_id: ME, name: "Empty Co", is_sample: false },
      { id: "c-inv", user_id: ME, name: "Has Invoice", is_sample: false },
      { id: "c-est", user_id: ME, name: "Has Estimate", is_sample: false },
      { id: "c-draft", user_id: ME, name: "Has Draft", is_sample: false },
      { id: "c-job", user_id: ME, name: "Has Job", is_sample: false },
      { id: "c-theirs", user_id: OTHER, name: "Theirs", is_sample: false },
      { id: "c-sample", user_id: ME, name: "Sample", is_sample: true },
    ],
    documents: [
      { id: "d1", user_id: ME, client_id: "c-inv", type: "invoice", status: "paid" },
      { id: "d2", user_id: ME, client_id: "c-est", type: "estimate", status: "sent" },
      { id: "d3", user_id: ME, client_id: "c-draft", type: "invoice", status: "draft" },
    ],
    jobs: [
      { id: "j1", user_id: ME, client_id: "c-job", is_sample: false },
      { id: "j2", user_id: ME, client_id: "c-sample", is_sample: true },
    ],
    ...extra,
  } as Record<string, Row[]>;
}

test("a client with no references is deleted", async () => {
  const t = world();
  const res = await handleClientDelete(fakeDb(t), ME, "c-empty");
  assert.equal(res.status, 200);
  assert.ok(!t.clients.some((c) => c.id === "c-empty"));
});

test("blocked with an invoice: 409, counts, nothing deleted, invoice untouched", async () => {
  const t = world();
  const res = await handleClientDelete(fakeDb(t), ME, "c-inv");
  assert.equal(res.status, 409);
  if (res.status !== 409) return;
  assert.deepEqual(res.body.counts, { invoices: 1, estimates: 0, jobs: 0 });
  assert.equal(res.body.code, "CLIENT_HAS_RECORDS");
  assert.match(res.body.error, /Has Invoice has 1 invoice, so it can't be deleted\. Delete or reassign those first\./);
  assert.ok(t.clients.some((c) => c.id === "c-inv"));
  assert.equal(t.documents.length, 3);
});

test("blocked with only an estimate", async () => {
  const t = world();
  const res = await handleClientDelete(fakeDb(t), ME, "c-est");
  assert.equal(res.status, 409);
  if (res.status === 409) assert.deepEqual(res.body.counts, { invoices: 0, estimates: 1, jobs: 0 });
  assert.ok(t.clients.some((c) => c.id === "c-est"));
});

test("blocked with only a draft", async () => {
  const t = world();
  const res = await handleClientDelete(fakeDb(t), ME, "c-draft");
  assert.equal(res.status, 409);
  assert.ok(t.clients.some((c) => c.id === "c-draft"));
});

test("blocked by a job, with its own wording", async () => {
  const t = world();
  const res = await handleClientDelete(fakeDb(t), ME, "c-job");
  assert.equal(res.status, 409);
  if (res.status === 409) assert.match(res.body.error, /has 1 job, so it can't be deleted\. Remove them from those jobs first\./);
});

test("another user's client is refused (404) and survives", async () => {
  const t = world();
  const res = await handleClientDelete(fakeDb(t), ME, "c-theirs");
  assert.equal(res.status, 404);
  assert.ok(t.clients.some((c) => c.id === "c-theirs"));
});

test("a record owned by someone else does not block my delete of a same-id client", async () => {
  const t = world({ documents: [{ id: "x", user_id: OTHER, client_id: "c-empty", type: "invoice", status: "draft" }] });
  assert.equal((await handleClientDelete(fakeDb(t), ME, "c-empty")).status, 200);
});

test("the sample client is removable in one go, with its sample job; its real data would still block", async () => {
  const t = world();
  const res = await handleClientDelete(fakeDb(t), ME, "c-sample");
  assert.equal(res.status, 200);
  assert.ok(!t.clients.some((c) => c.id === "c-sample"));
  assert.ok(!t.jobs.some((j) => j.id === "j2"));
  assert.ok(t.jobs.some((j) => j.id === "j1")); // other jobs untouched
});

test("a delete frees a Free-plan client slot", async () => {
  // Free allows 3 clients; the sample client never counts.
  const t = world({
    clients: [
      { id: "a", user_id: ME, name: "A", is_sample: false },
      { id: "b", user_id: ME, name: "B", is_sample: false },
      { id: "c", user_id: ME, name: "C", is_sample: false },
      { id: "s", user_id: ME, name: "Sample", is_sample: true },
    ],
    documents: [],
    jobs: [],
  });
  const db = fakeDb(t);
  const before = await wouldExceedTotalLimit(db, ME, "clients");
  assert.equal(before.exceeded, true);
  assert.equal(before.current, 3);

  assert.equal((await handleClientDelete(db, ME, "b")).status, 200);

  const after = await wouldExceedTotalLimit(db, ME, "clients");
  assert.equal(after.exceeded, false);
  assert.equal(after.current, 2);
});

test("wording: counts are listed, zero counts are left out", () => {
  assert.equal(describeReferences({ invoices: 3, estimates: 1, jobs: 0 }), "3 invoices and 1 estimate");
  assert.equal(describeReferences({ invoices: 2, estimates: 1, jobs: 1 }), "2 invoices, 1 estimate and 1 job");
  assert.equal(
    blockedMessage(" Ann ", { invoices: 3, estimates: 1, jobs: 0 }),
    "Ann has 3 invoices and 1 estimate, so it can't be deleted. Delete or reassign those first.",
  );
});

test("the route authenticates and passes the session user's id, never one from the request", () => {
  const src = readFileSync(new URL("../app/api/clients/[id]/route.ts", import.meta.url), "utf8");
  assert.match(src, /handleClientDelete\(result\.supabase, result\.user\.id, id\)/);
  const server = readFileSync(new URL("./client-delete-server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(server, /console\./);
});
