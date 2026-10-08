import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { QUANTITY_MESSAGE, parseQuantity } from "./line-items-server.ts";
import { saveReusableItems } from "./save-line-items.ts";

test("quantity: absent means 'use the default of 1' (nothing sent)", () => {
  assert.deepEqual(parseQuantity(undefined), {});
  assert.deepEqual(parseQuantity(null), {});
  assert.deepEqual(parseQuantity(""), {});
});

test("quantity: positive numbers pass, rounded to cents like the column", () => {
  assert.deepEqual(parseQuantity(3), { quantity: 3 });
  assert.deepEqual(parseQuantity("2.5"), { quantity: 2.5 });
  assert.deepEqual(parseQuantity(2.456), { quantity: 2.46 });
});

test("quantity: zero, negative and junk are a 400 message", () => {
  for (const bad of [0, -1, "abc", Number.NaN, Infinity]) {
    assert.deepEqual(parseQuantity(bad), { error: QUANTITY_MESSAGE }, String(bad));
  }
});

test("saving a ticked item sends its quantity (when usable) and price", async () => {
  const bodies: Record<string, unknown>[] = [];
  const impl = (async (_u: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 201 });
  }) as typeof fetch;
  await saveReusableItems(
    [
      { description: "A", unit_price: 5, quantity: 4 },
      { description: "B", unit_price: 6 },
      { description: "C", unit_price: 7, quantity: 0 },
    ],
    impl,
  );
  assert.deepEqual(bodies[0], { description: "A", unit_price: 5, quantity: 4 });
  assert.deepEqual(bodies[1], { description: "B", unit_price: 6 });
  assert.deepEqual(bodies[2], { description: "C", unit_price: 7 });
});

// UI wiring that can't be rendered here (no DOM library in the project).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("all three forms use the searchable picker, not the Base UI Select", () => {
  for (const file of [
    "../components/invoices/document-editor.tsx",
    "../components/invoices/document-builder.tsx",
    "../components/jobs/log-contract-change-dialog.tsx",
  ]) {
    const src = read(file);
    assert.match(src, /<SavedItemPicker/, file);
    assert.doesNotMatch(src, /insertPick|savedItemSelectItems|INSERT_SAVED_PLACEHOLDER/, file);
  }
});

test("the picker has a search box and a natively scrolling list", () => {
  const src = read("../components/invoices/saved-item-picker.tsx");
  assert.match(src, /filterSavedItems\(/);
  assert.match(src, /type="search"/);
  assert.match(src, /overflow-y-auto/);
  assert.doesNotMatch(src, /@base-ui|ui\/select/);
});

test("no saved-item save is fire-and-forget any more", () => {
  for (const file of [
    "../components/invoices/document-editor.tsx",
    "../components/invoices/document-builder.tsx",
    "../components/jobs/log-contract-change-dialog.tsx",
  ]) {
    const src = read(file);
    assert.match(src, /await saveReusableItems\(/, file);
    assert.match(src, /savedItemsFailureMessage\(/, file);
    assert.doesNotMatch(src, /\/api\/line-items/, file);
  }
});

test("deleting a document or a payment asks first; a future-dated payment is warned about", () => {
  const src = read("../components/invoices/document-detail.tsx");
  // The buttons open a confirmation instead of deleting straight away.
  assert.doesNotMatch(src, /onClick=\{handleDelete\}/);
  assert.doesNotMatch(src, /onClick=\{\(\) => handleDeletePayment\(/);
  assert.match(src, /setConfirmDeleteDocOpen\(true\)/);
  assert.match(src, /setPaymentToDelete\(payment\)/);
  // The payment form (future-date warning, Collect remaining balance) is one shared component.
  assert.match(src, /<PaymentForm/);
  const form = read("../components/invoices/payment-form.tsx");
  assert.match(form, /isFuturePaymentDate\(date\)/);
  assert.match(form, /Collect remaining balance/);
});

test("an estimate's date reads 'Valid until' on the form, detail page, PDF and public page", () => {
  for (const file of [
    "../components/invoices/document-editor.tsx",
    "../components/invoices/document-builder.tsx",
    "../components/invoices/document-detail.tsx",
    "../components/public/document-paper.tsx",
    "./invoice-pdf.ts",
  ]) {
    assert.match(read(file), /dueDateLabel\(/, file);
  }
});
