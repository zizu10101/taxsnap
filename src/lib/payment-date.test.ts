import { test } from "node:test";
import assert from "node:assert/strict";
import { isFuturePaymentDate, localIsoDate } from "./payment-date.ts";
import { dueDateLabel } from "./document-labels.ts";

// Local time on purpose: the owner's "today" is their wall clock, not UTC.
const NOON = new Date(2026, 9, 8, 12, 0, 0); // 2026-10-08 12:00 local
const LATE_EVENING = new Date(2026, 9, 8, 22, 30, 0); // still the 8th locally, already the 9th in UTC in Toronto

test("localIsoDate is the local calendar date", () => {
  assert.equal(localIsoDate(NOON), "2026-10-08");
  assert.equal(localIsoDate(LATE_EVENING), "2026-10-08");
  assert.equal(localIsoDate(new Date(2026, 0, 5, 0, 1)), "2026-01-05");
});

test("today and the past are not future", () => {
  assert.equal(isFuturePaymentDate("2026-10-08", NOON), false);
  assert.equal(isFuturePaymentDate("2026-10-07", NOON), false);
  assert.equal(isFuturePaymentDate("2025-12-31", NOON), false);
});

test("tomorrow and later are future", () => {
  assert.equal(isFuturePaymentDate("2026-10-09", NOON), true);
  assert.equal(isFuturePaymentDate("2027-01-01", NOON), true);
});

test("a late-evening default (today, locally) doesn't trigger the warning", () => {
  assert.equal(isFuturePaymentDate(localIsoDate(LATE_EVENING), LATE_EVENING), false);
});

test("an empty or malformed date is not flagged (the required-field check owns that)", () => {
  assert.equal(isFuturePaymentDate("", NOON), false);
  assert.equal(isFuturePaymentDate("2026-10", NOON), false);
});

test("an estimate's date is 'Valid until'; an invoice's stays 'Due date'", () => {
  assert.equal(dueDateLabel("estimate"), "Valid until");
  assert.equal(dueDateLabel("invoice"), "Due date");
});
