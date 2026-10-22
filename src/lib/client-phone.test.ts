import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CLIENT_PHONE_MAX_LENGTH, normalizePhone, telHref } from "./client-phone.ts";

test("empty, blank and missing mean null", () => {
  for (const v of [undefined, null, "", "   "]) assert.deepEqual(normalizePhone(v), { ok: true, value: null });
});

test("trims and accepts digits, spaces and + - ( ) . with an optional ext", () => {
  for (const v of ["555-0100", "(416) 555.0100", "+1 416 555 0100", "416 555 0100 ext 22", "416-555-0100 EXT. 5"]) {
    assert.deepEqual(normalizePhone(`  ${v}  `), { ok: true, value: v }, v);
  }
});

test("rejects letters, other symbols, no digits, bad extensions and non-strings", () => {
  for (const v of ["call me", "555-0100 x22", "555#0100", "+-()", "ext 22", "555 ext", "<script>1</script>"]) {
    assert.equal(normalizePhone(v).ok, false, v);
  }
  assert.equal(normalizePhone(5550100).ok, false);
});

test("40 characters at most", () => {
  assert.equal(normalizePhone("1".repeat(CLIENT_PHONE_MAX_LENGTH)).ok, true);
  assert.equal(normalizePhone("1".repeat(CLIENT_PHONE_MAX_LENGTH + 1)).ok, false);
});

test("tel: links keep digits and a leading +, and drop the extension", () => {
  assert.equal(telHref("(416) 555-0100"), "tel:4165550100");
  assert.equal(telHref("+1 416 555 0100 ext 22"), "tel:+14165550100");
});

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("create and update routes validate the phone", () => {
  assert.match(read("../app/api/clients/route.ts"), /normalizePhone\(phone\)/);
  assert.match(read("../app/api/clients/[id]/route.ts"), /normalizePhone\(phone\)/);
});

test("phone stays internal: public pages select explicit client columns, never phone", () => {
  for (const p of ["../app/invoice/[token]/page.tsx", "../app/sign/[token]/page.tsx"]) {
    const src = read(p);
    assert.doesNotMatch(src, /client:clients\(\*\)/, p);
    assert.match(src, /client:clients\(name, email, address\)/, p);
  }
  // portal, accountant export, PDFs, emails and document renderers never mention a client phone
  for (const p of [
    "./client-portal-server.ts",
    "./invoice-pdf.ts",
    "../app/api/documents/[id]/send-email/route.ts",
    "../app/api/accountant-portal/export-data/route.ts",
    "../components/public/document-paper.tsx",
    "../components/invoices/document-detail.tsx",
  ]) {
    assert.doesNotMatch(read(p), /client\??\.phone|clients\([^)]*phone/, p);
  }
});
