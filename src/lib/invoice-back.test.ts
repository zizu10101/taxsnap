import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { invoiceDetailHref, resolveInvoiceBack } from "./invoice-back.ts";

const JOB = "0b7f6c1e-3a52-4c7e-9d0a-5b1c2d3e4f50";

test("no ?from= means Invoices", () => {
  assert.deepEqual(resolveInvoiceBack(undefined), { href: "/dashboard/invoices", label: "invoices" });
  assert.deepEqual(resolveInvoiceBack(null), { href: "/dashboard/invoices", label: "invoices" });
  assert.deepEqual(resolveInvoiceBack(""), { href: "/dashboard/invoices", label: "invoices" });
});

test("from=invoices and from=progress-billing", () => {
  assert.equal(resolveInvoiceBack("invoices").href, "/dashboard/invoices");
  assert.deepEqual(resolveInvoiceBack("progress-billing"), {
    href: "/dashboard/progress-billing",
    label: "Progress Billing",
  });
});

test("from=progress-billing:<job id> returns to that job's summary", () => {
  assert.deepEqual(resolveInvoiceBack(`progress-billing:${JOB}`), {
    href: `/dashboard/progress-billing/${JOB}`,
    label: "Progress Billing",
  });
  assert.equal(
    resolveInvoiceBack(`progress-billing:${JOB.toUpperCase()}`).href,
    `/dashboard/progress-billing/${JOB}`,
  );
});

test("a bad job id falls back to the Progress Billing list, never into the URL", () => {
  for (const bad of [
    "progress-billing:",
    "progress-billing:abc",
    "progress-billing:../../auth",
    `progress-billing:${JOB}/x`,
  ]) {
    assert.equal(resolveInvoiceBack(bad).href, "/dashboard/progress-billing", bad);
  }
});

test("anything else (a URL, another page, junk) is Invoices: no open redirect", () => {
  for (const evil of [
    "https://evil.example",
    "//evil.example",
    "/dashboard/settings",
    "javascript:alert(1)",
    "../x",
    "INVOICES",
  ]) {
    assert.deepEqual(resolveInvoiceBack(evil), { href: "/dashboard/invoices", label: "invoices" }, evil);
  }
});

test("a repeated ?from= uses the first", () => {
  assert.equal(resolveInvoiceBack(["progress-billing", "invoices"]).href, "/dashboard/progress-billing");
});

test("invoiceDetailHref builds the link the page understands", () => {
  assert.equal(invoiceDetailHref("abc"), "/dashboard/invoices/abc?from=invoices");
  assert.equal(invoiceDetailHref("abc", "progress-billing"), "/dashboard/invoices/abc?from=progress-billing");
  const href = invoiceDetailHref("abc", `progress-billing:${JOB}`);
  const from = new URL(href, "https://x.test").searchParams.get("from");
  assert.equal(resolveInvoiceBack(from).href, `/dashboard/progress-billing/${JOB}`);
});

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the Invoices list and Progress Billing open an invoice through invoiceDetailHref", () => {
  for (const file of [
    "../components/invoices/document-list.tsx",
    "../components/invoices/document-workstation.tsx",
    "../components/jobs/progress-billing-list.tsx",
    "../components/jobs/progress-billing-summary.tsx",
  ]) {
    const src = read(file);
    assert.match(src, /invoiceDetailHref\(/, file);
    // No hand-built link to a draw/new invoice that would drop ?from=.
    assert.doesNotMatch(src, /\/dashboard\/invoices\/\$\{(draw\.id|saved\.id|doc\.id)\}/, file);
  }
});

test("the invoice detail page resolves ?from= and hands it to the detail component", () => {
  const page = read("../app/(app)/dashboard/invoices/[id]/page.tsx");
  assert.match(page, /resolveInvoiceBack\(\(await searchParams\)\.from\)/);
  assert.match(page, /backLink=\{back\}/);
  const detail = read("../components/invoices/document-detail.tsx");
  assert.match(detail, /backLink\?\.href \?\? basePath/);
  // The old guess from the document itself is gone.
  assert.doesNotMatch(detail, /doc\.is_progress_draw \? "\/dashboard\/progress-billing"/);
});
