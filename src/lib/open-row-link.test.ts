import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openRowAriaLabel } from "./open-row-link.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the aria-label names the kind and the record", () => {
  assert.equal(openRowAriaLabel("invoice", "INV-1003"), "Open invoice INV-1003");
  assert.equal(openRowAriaLabel("estimate", "EST-0007"), "Open estimate EST-0007");
  assert.equal(openRowAriaLabel("job", "  Kitchen reno "), "Open job Kitchen reno");
  assert.equal(openRowAriaLabel("client", "Acme Ltd"), "Open client Acme Ltd");
  assert.equal(openRowAriaLabel("client", "   "), "Open client");
});

test("OpenRowLink is a real Next Link to the given href, with a label, and stops click and key events", () => {
  const src = read("../components/ui/open-row-link.tsx");
  assert.match(src, /import Link from "next\/link"/);
  assert.match(src, /<Link\s+href=\{href\}/);
  assert.match(src, /aria-label=\{openRowAriaLabel\(kind, name\)\}/);
  assert.match(src, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(src, /onKeyDown=\{\(e\) => e\.stopPropagation\(\)\}/, "Enter on the link must not reach the row's key handler");
  assert.match(src, /focus-visible:ring/);
  assert.match(src, /min-h-11/, "about 44px tap target");
  assert.doesNotMatch(src, /bg-primary|Button/, "quiet: no filled or orange button");
});

test("all four lists use it, to the same routes as View full details", () => {
  const doc = read("../components/invoices/document-workstation.tsx");
  const job = read("../components/jobs/job-workstation.tsx");
  const client = read("../components/clients/client-workstation.tsx");
  for (const [name, src] of [
    ["document-workstation", doc],
    ["job-workstation", job],
    ["client-workstation", client],
    ["document-list", read("../components/invoices/document-list.tsx")],
    ["job-list", read("../components/jobs/job-list.tsx")],
    ["client-list", read("../components/clients/client-list.tsx")],
  ]) {
    assert.match(src, /<OpenRowLink/, `${name} renders OpenRowLink`);
  }
  assert.match(doc, /<OpenRowLink\s+href=\{doc\.type === "invoice" \? invoiceDetailHref\(doc\.id, "invoices"\) : `\$\{basePath\}\/\$\{doc\.id\}`\}/);
  assert.match(job, /<OpenRowLink href=\{`\/dashboard\/jobs\/\$\{job\.id\}`\}/);
  assert.match(client, /<OpenRowLink href=\{`\/dashboard\/clients\/\$\{client\.id\}`\}/);
  // the preview panels keep their own button
  for (const src of [doc, job, client]) assert.match(src, /View full details/);
});
