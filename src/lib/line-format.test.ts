import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NO_CLIENT_EMAIL_NOTE,
  OTHER_UNIT,
  UNIT_MAX_LENGTH,
  UNIT_PRESETS,
  formatQuantity,
  formatQuantityNumber,
  isCustomUnit,
  lineDescription,
  lineName,
  lineText,
  normalizeUnit,
  parseLineInputs,
  readLineLabels,
  sendMenu,
  unitError,
  unitSelectValue,
} from "./line-format.ts";
import { checkPdfUpload, MAX_EMAIL_PDF_BYTES } from "./send-email-rules.ts";

const readLf = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

// ---- old-data fallback ----

test("an old line (no name) shows its old description as the name, with no description", () => {
  const old = { name: null, description: "Potlights, 6 inch" };
  assert.equal(lineName(old), "Potlights, 6 inch");
  assert.equal(lineDescription(old), "");
  assert.equal(lineName({ description: "Potlights" }), "Potlights"); // name key absent entirely
  assert.equal(lineDescription({ description: "Potlights" }), "");
  assert.equal(lineText(old), "Potlights, 6 inch");
});

test("a new line keeps its name and description apart", () => {
  const line = { name: "Potlights", description: "6 inch, dimmable", unit: "each" };
  assert.equal(lineName(line), "Potlights");
  assert.equal(lineDescription(line), "6 inch, dimmable");
  assert.equal(lineText(line), "Potlights - 6 inch, dimmable");
});

test("a new line with a name and an empty description has no description (not the name twice)", () => {
  const line = { name: "Labour", description: "" };
  assert.equal(lineName(line), "Labour");
  assert.equal(lineDescription(line), "");
});

test("whitespace is trimmed and a missing description reads as empty", () => {
  assert.equal(lineName({ name: "  Paint  ", description: null }), "Paint");
  assert.equal(lineDescription({ name: "Paint", description: null }), "");
  assert.equal(lineDescription({ name: "Paint", description: "  two coats " }), "two coats");
});

// ---- units ----

test("the unit presets are exactly the requested list", () => {
  assert.deepEqual([...UNIT_PRESETS], ["each", "hr", "day", "sq ft", "linear ft", "m", "yd"]);
});

test("a blank unit is no unit, and looks exactly like a line did before units", () => {
  for (const blank of [undefined, null, "", "   "]) {
    assert.equal(normalizeUnit(blank), null);
    assert.equal(formatQuantity(3, blank), "3");
  }
  assert.equal(formatQuantity(1, null), "1");
});

test("quantity is shown with its unit next to it", () => {
  assert.equal(formatQuantity(2, "hr"), "2 hr");
  assert.equal(formatQuantity(40, "linear ft"), "40 linear ft");
  assert.equal(formatQuantity(1.5, "day"), "1.5 day");
  assert.equal(formatQuantity(2.5, "  sq   ft "), "2.5 sq ft"); // trimmed, spaces collapsed
});

test("quantity text has no floating-point noise and no trailing zeros", () => {
  assert.equal(formatQuantityNumber(3), "3");
  assert.equal(formatQuantityNumber(1.1 + 2.2), "3.3");
  assert.equal(formatQuantityNumber(2.5), "2.5");
  assert.equal(formatQuantityNumber(0.125), "0.13");
  assert.equal(formatQuantityNumber(Number.NaN), "0");
});

test("a unit that is not a preset is a free-text 'other'", () => {
  assert.equal(isCustomUnit("hr"), false);
  assert.equal(isCustomUnit("bundle"), true);
  assert.equal(isCustomUnit(null), false);
  assert.equal(isCustomUnit(""), false);
  assert.equal(unitSelectValue(null), "");
  assert.equal(unitSelectValue("yd"), "yd");
  assert.equal(unitSelectValue("bundle"), OTHER_UNIT);
  assert.equal(formatQuantity(4, "bundle"), "4 bundle");
});

test("a unit over the length limit is refused with a message; at the limit it is fine", () => {
  assert.equal(unitError("x".repeat(UNIT_MAX_LENGTH)), null);
  assert.match(unitError("x".repeat(UNIT_MAX_LENGTH + 1)) ?? "", /20 characters or fewer/);
  assert.equal(unitError(""), null);
  assert.equal(unitError(undefined), null);
});

// ---- request bodies ----

test("a body line with a name and description is read as sent, with its unit", () => {
  assert.deepEqual(readLineLabels({ name: " Potlights ", description: " 6 inch ", unit: " each " }), {
    name: "Potlights",
    description: "6 inch",
    unit: "each",
  });
});

test("an older caller that sends only a description is read as name = description", () => {
  assert.deepEqual(readLineLabels({ description: "Potlights" }), { name: "Potlights", description: "", unit: null });
});

test("a line with no name is dropped, whatever its description says", () => {
  assert.equal(readLineLabels({ name: "   ", description: "orphan text" }), null);
  assert.equal(readLineLabels({}), null);
  assert.equal(readLineLabels({ description: "  " }), null);
});

test("parseLineInputs keeps order, numbers, drops nameless lines and refuses a long unit", () => {
  const ok = parseLineInputs([
    { name: "A", description: "a", unit: "hr", quantity: "2", unit_price: 10 },
    { name: "", description: "dropped" },
    { description: "B (old shape)", quantity: 1, unit_price: 5 },
  ]);
  assert.ok("lines" in ok);
  if ("lines" in ok) {
    assert.deepEqual(ok.lines, [
      { name: "A", description: "a", unit: "hr", quantity: 2, unit_price: 10 },
      { name: "B (old shape)", description: "", unit: null, quantity: 1, unit_price: 5 },
    ]);
  }
  const bad = parseLineInputs([{ name: "A", unit: "x".repeat(UNIT_MAX_LENGTH + 1) }]);
  assert.ok("error" in bad);
  assert.deepEqual(parseLineInputs(undefined), { lines: [] });
});

// ---- Send menu rules ----

test("with a client email the Send menu offers Email, Copy link and Download PDF, with no note", () => {
  const menu = sendMenu({ clientEmail: "a@b.ca" });
  assert.deepEqual(
    menu.options.map((o) => o.label),
    ["Email to client", "Copy link", "Download PDF"],
  );
  assert.deepEqual(
    menu.options.map((o) => o.action),
    ["email", "copy-link", "download-pdf"],
  );
  assert.equal(menu.note, null);
});

test("without a client email, 'Email to client' is hidden and the menu says why", () => {
  for (const email of [null, undefined, "", "   "]) {
    const menu = sendMenu({ clientEmail: email });
    assert.deepEqual(
      menu.options.map((o) => o.action),
      ["copy-link", "download-pdf"],
    );
    assert.equal(menu.note, NO_CLIENT_EMAIL_NOTE);
  }
  assert.match(NO_CLIENT_EMAIL_NOTE, /no email on file/);
});

test("the PDF to email must be a real PDF, non-empty and not over the limit", () => {
  const pdf = new TextEncoder().encode("%PDF-1.3 hello");
  assert.equal(checkPdfUpload(pdf), null);
  assert.equal(checkPdfUpload(new Uint8Array(0))?.status, 400);
  assert.equal(checkPdfUpload(new TextEncoder().encode("<html>nope</html>"))?.status, 400);
  const big = new Uint8Array(MAX_EMAIL_PDF_BYTES + 1);
  big.set(pdf);
  assert.equal(checkPdfUpload(big)?.status, 413);
});

test("sending never changes the document: the email route does not write to documents", () => {
  const src = readLf("src/app/api/documents/[id]/send-email/route.ts");
  assert.ok(!/\.update\(|\.insert\(|\.delete\(|\.upsert\(/.test(src));
  assert.ok(!/status:\s*["'`]/.test(src), "never sets a document status");
  assert.ok(!/from\("documents"\)\s*\.(update|insert|delete|upsert)/.test(src));
  // the recipient comes from the client row, never from the request
  assert.ok(src.includes("client.email"));
  assert.ok(!/formData\(\)[\s\S]*get\("(to|email)"\)/.test(src));
  assert.ok(src.includes('.eq("user_id", user.id)'));
});

test("the share-link route only creates a token, never a status", () => {
  const src = readLf("src/app/api/documents/[id]/share-link/route.ts");
  assert.ok(!/\.update\(/.test(src));
  const lib = readLf("src/lib/document-sign-link.ts");
  const updates = lib.match(/\.update\(\{[^}]*\}\)/g) ?? [];
  assert.deepEqual(updates, ['.update({ sign_token: token })', '.update({ view_token: token })']);
});

test("the detail page has one Send menu and no separate Email / Email Signature Link buttons", () => {
  const src = readLf("src/components/invoices/document-detail.tsx");
  assert.ok(src.includes("<SendDocumentMenu"));
  assert.ok(!src.includes("EmailSignatureLinkButton"));
  assert.ok(!src.includes("GetSignatureLinkButton"));
  assert.ok(!src.includes("<ShareDocumentButton"));
});

test("the Send menu takes its options from sendMenu() and never PATCHes the document", () => {
  const src = readLf("src/components/invoices/send-document-menu.tsx");
  assert.ok(src.includes("sendMenu("));
  assert.ok(!/method: "PATCH"/.test(src));
  assert.ok(!/status:\s*["'`]/.test(src), "never sets a document status");
});

// ---- display wiring ----

test("every place a line is shown uses the shared name/description/unit helpers", () => {
  for (const file of [
    "src/components/invoices/document-detail.tsx",
    "src/components/public/document-paper.tsx",
    "src/components/invoices/document-workstation.tsx",
    "src/components/clients/client-workstation.tsx",
    "src/lib/invoice-pdf.ts",
  ]) {
    const src = readLf(file);
    assert.ok(src.includes("lineName"), `${file} should use lineName`);
    assert.ok(src.includes("lineDescription"), `${file} should use lineDescription`);
  }
  for (const file of [
    "src/components/invoices/document-detail.tsx",
    "src/components/public/document-paper.tsx",
    "src/lib/invoice-pdf.ts",
  ]) {
    assert.ok(readLf(file).includes("formatQuantity"), `${file} should show the unit via formatQuantity`);
  }
});

test("migration 0061 is wrapped in begin/commit, adds nullable name+unit with no backfill, and has a rollback", () => {
  const up = readLf("supabase/migrations/0061_line_name_description_unit.sql");
  assert.match(up, /^begin;$/m);
  assert.match(up, /^commit;$/m);
  assert.ok(up.includes("add column if not exists name text"));
  assert.ok(up.includes("add column if not exists unit text"));
  assert.ok(!/^\s*update /im.test(up), "no backfill");
  assert.ok(!/not null/i.test(up.split("alter table")[1] ?? ""), "name/unit stay nullable");
  const down = readLf("supabase/rollbacks/0061_line_name_description_unit_rollback.sql");
  assert.match(down, /drop column if exists name/);
  assert.match(down, /drop column if exists unit/);
  // names are folded back into description before the column goes, so no text is lost
  assert.ok(down.indexOf("set description") < down.indexOf("drop column"));
});
