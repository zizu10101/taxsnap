import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PORTAL_DOCUMENT_COLUMNS,
  filterPortalRows,
  invoiceBalance,
  summarizePortalBalance,
  summarizePortalRange,
  toPortalRow,
  type PortalDocumentRow,
} from "./client-portal.ts";

function raw(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    type: "invoice" as const,
    status: "sent",
    document_number: 1001,
    issue_date: "2026-08-01",
    due_date: null,
    total_amount: 1000,
    payments: [] as { amount: number }[],
    ...over,
  };
}

function rows(...inputs: ReturnType<typeof raw>[]): PortalDocumentRow[] {
  return inputs.map((r) => toPortalRow(r)).filter((r): r is PortalDocumentRow => r !== null);
}

test("drafts are never shown to a client", () => {
  assert.equal(toPortalRow(raw({ status: "draft" })), null);
  assert.equal(toPortalRow(raw({ type: "estimate", status: "draft" })), null);
});

test("sent, partial and paid documents are shown", () => {
  for (const status of ["sent", "partial", "paid"]) {
    assert.notEqual(toPortalRow(raw({ status })), null, status);
  }
});

test("invoice balance is total minus payments, never negative", () => {
  assert.equal(invoiceBalance(1000, 400), 600);
  assert.equal(invoiceBalance(1000, 1000), 0);
  assert.equal(invoiceBalance(1000, 1200), 0);
  assert.equal(invoiceBalance(0.3, 0.1), 0.2);
});

test("an estimate has no paid amount and no balance", () => {
  const row = toPortalRow(
    raw({ type: "estimate", total_amount: 5000, payments: [{ amount: 100 }] }),
  )!;
  assert.equal(row.paid, 0);
  assert.equal(row.balance, 0);
});

test("Outstanding Balance counts invoices only, never estimates", () => {
  const all = rows(
    raw({ id: "a", total_amount: 1000, payments: [{ amount: 250 }, { amount: 250 }] }),
    raw({ id: "b", total_amount: 800, status: "paid", payments: [{ amount: 800 }] }),
    raw({ id: "c", type: "estimate", total_amount: 9999 }),
  );
  assert.deepEqual(summarizePortalBalance(all), {
    invoiced: 1800,
    paid: 1300,
    outstanding: 500,
  });
});

test("an overpaid invoice does not hide what is owed on another", () => {
  const all = rows(
    raw({ id: "a", total_amount: 100, payments: [{ amount: 150 }] }),
    raw({ id: "b", total_amount: 300, payments: [] }),
  );
  assert.equal(summarizePortalBalance(all).outstanding, 300);
});

test("a draft invoice never contributes to the balance", () => {
  const all = rows(
    raw({ id: "a", total_amount: 100 }),
    raw({ id: "b", total_amount: 5000, status: "draft" }),
  );
  assert.equal(summarizePortalBalance(all).outstanding, 100);
});

test("date range filters by issue date, inclusive on both ends", () => {
  const all = rows(
    raw({ id: "a", issue_date: "2026-07-01" }),
    raw({ id: "b", issue_date: "2026-07-31" }),
    raw({ id: "c", issue_date: "2026-08-01" }),
    raw({ id: "d", issue_date: "2026-06-30" }),
  );
  const ids = filterPortalRows(all, { start: "2026-07-01", end: "2026-07-31" }).map((r) => r.id);
  assert.deepEqual(ids, ["a", "b"]);
  assert.equal(filterPortalRows(all, { start: null, end: null }).length, 4);
});

test("range summary adds invoices only", () => {
  const all = rows(
    raw({ id: "a", total_amount: 1000 }),
    raw({ id: "b", total_amount: 250.5 }),
    raw({ id: "c", type: "estimate", total_amount: 7000 }),
  );
  assert.deepEqual(summarizePortalRange(all), {
    count: 3,
    invoiceCount: 2,
    estimateCount: 1,
    invoicedInRange: 1250.5,
  });
});

// The portal's whole privacy story is "explicit column list, no job/cost
// data". Pin it: adding a sensitive column to this list should fail a test
// and force a conscious decision.
test("the portal's documents column whitelist stays free of sensitive columns", () => {
  const cols = PORTAL_DOCUMENT_COLUMNS.split(",").map((c) => c.trim());
  for (const banned of [
    "*",
    "user_id",
    "job_id",
    "client_id",
    "sign_token",
    "view_token",
    "signer_ip",
    "signer_name",
    "excluded_from_hst",
    "created_past_plan_limit",
    "converted_from_id",
    "draw_description",
    "draw_percent_complete",
  ]) {
    assert.ok(!cols.includes(banned), `${banned} must not be selected for clients`);
  }
});

test("portal code never reads job, cost, labor or receipt tables", () => {
  const files = [
    "client-portal.ts",
    "client-portal-server.ts",
    "client-session.ts",
    "../app/client/documents/page.tsx",
    "../app/client/documents/[id]/page.tsx",
    "../app/api/client-portal/documents/[id]/route.ts",
  ];
  for (const file of files) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const table of [
      "jobs",
      "contract_changes",
      "contract_change_items",
      "receipts",
      "hour_entries",
      "time_sessions",
      "employees",
      "commission_entries",
      "sales",
    ]) {
      assert.ok(
        !new RegExp(`from\\(\\s*["']${table}["']`).test(src),
        `${file} must not query ${table}`,
      );
    }
  }
});
