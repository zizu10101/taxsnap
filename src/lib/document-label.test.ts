import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { documentLabel } from "./document-label.ts";

const readLf = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

test("client and job read 'Client · Job'", () => {
  assert.equal(documentLabel("Ann Lee", "Kitchen reno"), "Ann Lee · Kitchen reno");
});

test("no linked job leaves out the job part", () => {
  for (const job of [null, undefined, "", "   "]) {
    assert.equal(documentLabel("Ann Lee", job), "Ann Lee");
  }
});

test("no client falls back to the placeholder, still showing the job", () => {
  assert.equal(documentLabel(null, null), "No client");
  assert.equal(documentLabel(undefined, undefined, "—"), "—");
  assert.equal(documentLabel(null, "Kitchen reno"), "No client · Kitchen reno");
});

test("names are trimmed", () => {
  assert.equal(documentLabel("  Ann ", " Kitchen "), "Ann · Kitchen");
});

test("the lists, workstation, detail header and accountant list use the shared label", () => {
  for (const f of [
    "src/components/invoices/document-list.tsx",
    "src/components/invoices/document-workstation.tsx",
    "src/components/invoices/document-detail.tsx",
    "src/components/accountant-portal/accountant-documents-view.tsx",
  ]) {
    assert.ok(readLf(f).includes("documentLabel("), f);
  }
});

test("the lists use the job already loaded with each document (no per-row query)", () => {
  for (const f of ["invoices", "estimates"]) {
    const src = readLf(`src/app/(app)/dashboard/${f}/page.tsx`);
    assert.ok(src.includes("job:jobs("), f);
  }
  for (const f of ["document-list", "document-workstation"]) {
    assert.ok(readLf(`src/components/invoices/${f}.tsx`).includes("doc.job?.name"), f);
  }
});

test("the client portal still never reads jobs (its privacy rule)", () => {
  const src = readLf("src/lib/client-portal-server.ts");
  assert.ok(!/jobs/.test(src.replace(/\/\/.*$/gm, "")));
});
