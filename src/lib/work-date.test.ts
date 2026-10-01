import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUTURE_DATE_MESSAGE,
  validateWorkDateForApi,
  validateWorkDateForDialog,
} from "./work-date.ts";

// 2026-10-01 14:00 in Toronto (EDT, UTC-4) = 18:00 UTC
const NOW = new Date("2026-10-01T18:00:00Z");

test("API: today and the past are accepted", () => {
  assert.equal(validateWorkDateForApi("2026-10-01", NOW), null);
  assert.equal(validateWorkDateForApi("2026-09-30", NOW), null);
  assert.equal(validateWorkDateForApi("2020-01-01", NOW), null);
});

test("API: clearly future dates are rejected with the standard message", () => {
  assert.equal(validateWorkDateForApi("2026-10-15", NOW), FUTURE_DATE_MESSAGE);
  assert.equal(validateWorkDateForApi("2027-01-01", NOW), FUTURE_DATE_MESSAGE);
  assert.equal(validateWorkDateForApi("2026-10-03", NOW), FUTURE_DATE_MESSAGE);
});

test("API: tomorrow is tolerated (timezones ahead of Toronto), the day after is not", () => {
  assert.equal(validateWorkDateForApi("2026-10-02", NOW), null);
  assert.equal(validateWorkDateForApi("2026-10-03", NOW), FUTURE_DATE_MESSAGE);
});

test("API: Toronto's own date is used, not UTC's", () => {
  // 2026-10-01 22:00 Toronto = 2026-10-02 02:00 UTC. UTC already says Oct 2,
  // Toronto still says Oct 1, so the limit is Oct 2 (not Oct 3).
  const lateEvening = new Date("2026-10-02T02:00:00Z");
  assert.equal(validateWorkDateForApi("2026-10-02", lateEvening), null);
  assert.equal(validateWorkDateForApi("2026-10-03", lateEvening), FUTURE_DATE_MESSAGE);
});

test("API: missing, empty and malformed values are rejected, not defaulted", () => {
  for (const bad of ["", undefined, null, 20261001, "2026-13-01", "2026-02-30", "10/01/2026", "2026-1-1", "not a date"]) {
    assert.equal(validateWorkDateForApi(bad, NOW), "Enter a valid date.", String(bad));
  }
});

test("dialog: strict against the person's local today", () => {
  assert.equal(validateWorkDateForDialog("2026-10-01", "2026-10-01"), null);
  assert.equal(validateWorkDateForDialog("2026-09-30", "2026-10-01"), null);
  assert.equal(validateWorkDateForDialog("2026-10-02", "2026-10-01"), FUTURE_DATE_MESSAGE);
  assert.equal(validateWorkDateForDialog("", "2026-10-01"), "Pick a date for these hours.");
});
