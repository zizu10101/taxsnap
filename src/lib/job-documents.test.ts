import { test } from "node:test";
import assert from "node:assert/strict";
import { groupJobDocuments, type JobDocumentRow } from "./job-documents.ts";

function doc(over: Partial<JobDocumentRow> & { id: string }): JobDocumentRow {
  return {
    type: "invoice",
    status: "sent",
    document_number: 1000,
    total_amount: 100,
    issue_date: "2026-10-01",
    is_progress_draw: false,
    draw_number: null,
    ...over,
  };
}

test("estimates, invoices and draws land in their own group, a draw only once", () => {
  const g = groupJobDocuments([
    doc({ id: "e1", type: "estimate" }),
    doc({ id: "i1" }),
    doc({ id: "d2", is_progress_draw: true, draw_number: 2, document_number: 1003 }),
    doc({ id: "d1", is_progress_draw: true, draw_number: 1, document_number: 1002 }),
  ]);
  assert.deepEqual(g.estimates.map((d) => d.id), ["e1"]);
  assert.deepEqual(g.invoices.map((d) => d.id), ["i1"]);
  assert.deepEqual(g.draws.map((d) => d.id), ["d1", "d2"]);
});

test("estimates and invoices list newest first, ties by number", () => {
  const g = groupJobDocuments([
    doc({ id: "a", issue_date: "2026-09-01", document_number: 1001 }),
    doc({ id: "b", issue_date: "2026-10-01", document_number: 1002 }),
    doc({ id: "c", issue_date: "2026-10-01", document_number: 1005 }),
  ]);
  assert.deepEqual(g.invoices.map((d) => d.id), ["c", "b", "a"]);
});

test("a job with nothing linked gives three empty groups", () => {
  assert.deepEqual(groupJobDocuments([]), { estimates: [], invoices: [], draws: [] });
});
