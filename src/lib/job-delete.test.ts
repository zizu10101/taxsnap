import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deleteConfirmText, jobDeleteBlocker, unlinkSummary } from "./job-delete.ts";

const clear = { draws: 0, changeOrders: 0, documentsWithPayments: 0, hourEntries: 0, timeSessions: 0 };
const readLf = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

test("a job with nothing in the way can be deleted", () => {
  assert.equal(jobDeleteBlocker(clear), null);
});

test("each blocker stops the delete and is named in the message", () => {
  const cases: [Partial<typeof clear>, RegExp][] = [
    [{ draws: 2 }, /2 progress billing draws/],
    [{ changeOrders: 1 }, /1 change order\b/],
    [{ documentsWithPayments: 3 }, /3 invoices or estimates with payments recorded/],
    [{ hourEntries: 4 }, /4 hours or clock-in records/],
    [{ timeSessions: 1 }, /1 hours or clock-in record\b/],
  ];
  for (const [over, re] of cases) {
    const msg = jobDeleteBlocker({ ...clear, ...over });
    assert.ok(msg && re.test(msg), JSON.stringify(over));
  }
});

test("several blockers are reported together, not one at a time", () => {
  const msg = jobDeleteBlocker({ ...clear, draws: 1, changeOrders: 2, documentsWithPayments: 1 });
  assert.ok(msg?.includes("progress billing draw") && msg.includes("change orders") && msg.includes("payments"));
});

test("the hint names only the blockers that are actually there", () => {
  const msg = jobDeleteBlocker({ ...clear, hourEntries: 2 })!;
  assert.ok(msg.includes("remove the hours"));
  assert.ok(!/change order/.test(msg));
  assert.ok(!/payments/.test(msg));
  const co = jobDeleteBlocker({ ...clear, changeOrders: 1 })!;
  assert.ok(co.includes("delete the change orders") && !/hours/.test(co));
});

test("the unlink summary counts what is kept, with correct plurals", () => {
  assert.equal(unlinkSummary({ documents: 0, expenses: 0, templates: 0 }), "");
  assert.equal(unlinkSummary({ documents: 1, expenses: 0, templates: 0 }), "1 invoice/estimate");
  assert.equal(
    unlinkSummary({ documents: 3, expenses: 2, templates: 0 }),
    "3 invoices/estimates and 2 expenses",
  );
  assert.equal(
    unlinkSummary({ documents: 3, expenses: 1, templates: 2 }),
    "3 invoices/estimates, 1 expense and 2 recurring expense templates",
  );
});

test("the confirm text says records are kept and unlinked, never deleted", () => {
  const text = deleteConfirmText({ documents: 2, expenses: 1, templates: 0 });
  assert.match(text, /2 invoices\/estimates and 1 expense/);
  assert.match(text, /kept and unlinked/);
  assert.match(deleteConfirmText({ documents: 0, expenses: 0, templates: 0 }), /Nothing is linked/);
});

test("DELETE /api/jobs/[id] scopes every query to the signed-in user and checks the job first", () => {
  const src = readLf("src/app/api/jobs/[id]/route.ts");
  const del = src.slice(src.indexOf("export async function DELETE"));
  // the job itself is looked up by id AND user_id before anything else runs
  assert.match(del, /from\("jobs"\)\s*\.select\("id"\)\s*\.eq\("id", id\)\s*\.eq\("user_id", user\.id\)/);
  assert.ok(del.indexOf('"Job not found."') < del.indexOf("Promise.all"));
  // every count / read of owned rows is user-scoped (contract_changes has no user_id: it is reached
  // through the job verified above)
  for (const table of ["documents", "hour_entries", "time_sessions", "receipts", "expense_templates"]) {
    const re = new RegExp(`from\\("${table}"\\)[\\s\\S]*?\\.eq\\("user_id", user\\.id\\)`);
    assert.ok(re.test(del), table);
  }
  // the final delete is scoped too
  assert.match(del, /from\("jobs"\)\.delete\(\)\.eq\("id", id\)\.eq\("user_id", user\.id\)/);
});

test("deleting a job only ever deletes the job row, and is blocked before that", () => {
  const src = readLf("src/app/api/jobs/[id]/route.ts");
  const del = src.slice(src.indexOf("export async function DELETE"));
  const deletes = del.match(/\.delete\(\)/g) ?? [];
  assert.equal(deletes.length, 1);
  assert.ok(del.indexOf("jobDeleteBlocker") < del.indexOf(".delete()"));
  assert.match(del, /status: 409/);
  for (const table of ["documents", "receipts", "hour_entries", "payments", "expense_templates"]) {
    assert.ok(!new RegExp(`from\\("${table}"\\)\\s*\\.delete`).test(del), table);
  }
});

test("the foreign keys unlink documents, expenses and templates (set null), and guard hours (restrict)", () => {
  const fk = (file: string, table: string) =>
    readLf(`supabase/migrations/${file}`).includes(table);
  const m = (file: string) => readLf(`supabase/migrations/${file}`);
  assert.match(m("0023_documents_job_link.sql"), /job_id uuid references public\.jobs \(id\) on delete set null/);
  assert.match(m("0009_jobs.sql"), /job_id uuid references public\.jobs \(id\) on delete set null/);
  assert.match(m("0027_expense_templates.sql"), /job_id uuid references public\.jobs \(id\) on delete set null/);
  assert.match(m("0010_employees_and_hours.sql"), /job_id uuid not null references public\.jobs \(id\) on delete restrict/);
  assert.ok(fk("0043_employee_login.sql", "time_sessions"));
});

test("the job page offers Delete through the ConfirmDialog", () => {
  const src = readLf("src/components/jobs/job-detail.tsx");
  assert.ok(src.includes("<ConfirmDialog"));
  assert.ok(src.includes('title="Delete this job?"'));
  assert.ok(src.includes('method: "DELETE"'));
});
