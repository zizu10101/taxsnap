import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateManualStatus } from "./document-status.ts";

test("draft and sent are accepted, and so is no status at all", () => {
  assert.equal(validateManualStatus("draft"), null);
  assert.equal(validateManualStatus("sent"), null);
  assert.equal(validateManualStatus(undefined), null);
  assert.equal(validateManualStatus(null), null);
  assert.equal(validateManualStatus(""), null);
});

test("paid and partial are rejected with a message that says what to do instead", () => {
  for (const status of ["paid", "partial"]) {
    const message = validateManualStatus(status);
    assert.ok(message, status);
    assert.match(message!, new RegExp(`"${status}"`));
    assert.match(message!, /payments/i);
    assert.match(message!, /Record a payment/);
  }
});

test("anything else is rejected too, naming the allowed values", () => {
  for (const status of ["void", "PAID", "Draft", 1, true, {}]) {
    const message = validateManualStatus(status);
    assert.ok(message, String(status));
  }
  assert.match(validateManualStatus("void")!, /draft, sent/);
});

// The route handlers need a signed-in request (cookies), which node:test can't
// supply, so these check the wiring: each route validates the status and
// answers 400 BEFORE it reads or writes anything.
function routeSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

for (const [name, path, anchor] of [
  ["POST /api/documents", "../app/api/documents/route.ts", "export async function POST"],
  ["PATCH /api/documents/[id]", "../app/api/documents/[id]/route.ts", "export async function PATCH"],
] as const) {
  test(`${name} rejects hand-set paid/partial with a 400 before touching the database`, () => {
    const src = routeSource(path);
    const handler = src.slice(src.indexOf(anchor));
    const checkAt = handler.indexOf("validateManualStatus(");
    assert.ok(checkAt > 0, "calls validateManualStatus");
    const after = handler.slice(checkAt, checkAt + 260);
    assert.match(after, /status: 400/);
    // No query/insert/update comes before the check (the auth lookup is fine).
    assert.equal(handler.slice(0, checkAt).includes(".insert("), false);
    assert.equal(handler.slice(0, checkAt).includes(".update("), false);
    assert.equal(handler.slice(0, checkAt).includes(".delete("), false);
  });
}

test("neither route can still write 'paid' from the request body", () => {
  const post = routeSource("../app/api/documents/route.ts");
  assert.doesNotMatch(post, /status === "paid"/);
  assert.match(post, /status: status === "sent" \? "sent" : "draft"/);
  const patch = routeSource("../app/api/documents/[id]/route.ts");
  assert.doesNotMatch(patch, /DOCUMENT_STATUSES/);
});

test("the detail page offers only Draft and Sent", () => {
  const src = readFileSync(new URL("../components/invoices/document-detail.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /<SelectItem value="paid">/);
  assert.doesNotMatch(src, /<SelectItem value="partial">/);
  assert.match(src, /<SelectItem value="draft">/);
  assert.match(src, /<SelectItem value="sent">/);
});

// ---- Editing an already-paid / partial invoice must not hit the new 400 ----

// The body an edit form sends, as a static slice of the source: from
// `const body = {` to its closing `};`.
function bodyLiteral(path: string) {
  const src = readFileSync(new URL(path, import.meta.url), "utf8");
  const start = src.indexOf("const body = {");
  assert.ok(start > 0, `${path}: finds the request body`);
  return src.slice(start, src.indexOf("\n      };", start));
}

test("the invoice editor and the builder never put `status` in the body they save", () => {
  for (const file of [
    "../components/invoices/document-editor.tsx",
    "../components/invoices/document-builder.tsx",
  ]) {
    assert.doesNotMatch(bodyLiteral(file), /\bstatus\b/, file);
  }
});

test("a PATCH shaped like an edit-form save passes the status check, whatever the invoice's status is", () => {
  const editBody: Record<string, unknown> = {
    type: "invoice",
    issue_date: "2026-10-01",
    due_date: null,
    client_id: "c1",
    job_id: null,
    items: [{ description: "Paint", quantity: 1, unit_price: 100 }],
  };
  assert.equal(validateManualStatus(editBody.status), null);
});

test("only the status dropdown sends `status`, and it can only send draft/sent", () => {
  const files = [
    "../components/invoices/document-detail.tsx",
    "../components/invoices/document-list.tsx",
    "../components/invoices/document-workstation.tsx",
    "../components/dashboard/hst-summary-card.tsx",
    "../components/jobs/progress-billing-summary.tsx",
    "../components/jobs/progress-billing-list.tsx",
  ];
  const senders = files.filter((f) =>
    /JSON\.stringify\(\{[^}]*\bstatus\b/.test(readFileSync(new URL(f, import.meta.url), "utf8")),
  );
  assert.deepEqual(senders, ["../components/invoices/document-detail.tsx"]);
});

test("convert (estimate to invoice) creates the invoice as a draft on the server and reads no client status", () => {
  const conversion = readFileSync(new URL("./estimate-conversion.ts", import.meta.url), "utf8");
  assert.match(conversion, /status: "draft"/);
  const route = readFileSync(new URL("../app/api/documents/[id]/convert/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /request\.json\(\)|body\.status/);
});
