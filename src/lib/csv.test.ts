import assert from "node:assert/strict";
import test from "node:test";
import { receiptsToQuickBooksCsv } from "./csv.ts";
import type { Receipt } from "./database.types.ts";

function receipt(overrides: Partial<Receipt>): Receipt {
  return {
    merchant_name: "Home Depot",
    transaction_date: "2026-03-14",
    total_amount: 0,
    tax_amount: 0,
    tax_category: "Supplies",
    ...overrides,
  } as Receipt;
}

test("QuickBooks export: a charge goes in Payment, Deposit stays blank", () => {
  const csv = receiptsToQuickBooksCsv([receipt({ total_amount: 48.2 })]);
  assert.equal(csv.split("\n")[1], "03/14/2026,Home Depot - Supplies,48.20,");
});

test("QuickBooks export: a refund goes in Deposit as a positive amount", () => {
  const csv = receiptsToQuickBooksCsv([receipt({ total_amount: -12.5 })]);
  assert.equal(csv.split("\n")[1], "03/14/2026,Refund - Home Depot - Supplies,,12.50");
});

test("QuickBooks export: no row ever carries a negative amount", () => {
  const csv = receiptsToQuickBooksCsv([
    receipt({ total_amount: 10 }),
    receipt({ total_amount: -10 }),
  ]);
  assert.ok(!csv.includes("-10.00"));
});
