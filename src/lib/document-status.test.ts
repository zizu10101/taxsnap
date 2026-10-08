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
