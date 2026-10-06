import assert from "node:assert/strict";
import test from "node:test";
import { attachDate, periodChange } from "./statement-attach-period.ts";

test("Feb 22 -> Feb 8 (the preauthorised-debit case) stays in the same month and quarter", () => {
  const c = periodChange("2026-02-22", "2026-02-08");
  assert.equal(c.crossesMonth, false);
  assert.equal(c.crossesQuarter, false);
});

test("Apr 3 -> Mar 28 crosses a month AND a quarter, with readable labels", () => {
  const c = periodChange("2026-04-03", "2026-03-28");
  assert.equal(c.crossesMonth, true);
  assert.equal(c.crossesQuarter, true);
  assert.deepEqual(
    [c.fromMonth, c.toMonth, c.fromQuarter, c.toQuarter],
    ["April 2026", "March 2026", "Q2 2026", "Q1 2026"],
  );
});

test("Feb 2 -> Jan 31 crosses a month but stays in Q1", () => {
  const c = periodChange("2026-02-02", "2026-01-31");
  assert.equal(c.crossesMonth, true);
  assert.equal(c.crossesQuarter, false);
});

test("a year boundary is a crossing in both senses", () => {
  const c = periodChange("2027-01-04", "2026-12-28");
  assert.equal(c.crossesMonth, true);
  assert.equal(c.crossesQuarter, true);
  assert.equal(c.toQuarter, "Q4 2026");
});

test("the same month in a different year is still a crossing", () => {
  assert.equal(periodChange("2026-02-10", "2025-02-10").crossesMonth, true);
});

test("quarter edges: Mar 31 and Apr 1 are different quarters; Jan 1 and Mar 31 are the same", () => {
  assert.equal(periodChange("2026-04-01", "2026-03-31").crossesQuarter, true);
  assert.equal(periodChange("2026-03-31", "2026-01-01").crossesQuarter, false);
  assert.equal(periodChange("2026-12-31", "2026-10-01").crossesQuarter, false);
});

// attachDate
test("attachDate: within the same month the receipt's date is used, no choice needed", () => {
  assert.deepEqual(attachDate("2026-02-22", "2026-02-08", undefined), { ok: true, date: "2026-02-08" });
});

test("attachDate: across a month boundary it refuses to guess - there is no default", () => {
  assert.deepEqual(attachDate("2026-04-03", "2026-03-28", undefined), { ok: false, code: "DATE_CHOICE_REQUIRED" });
});

test("attachDate: across a boundary the explicit choice decides", () => {
  assert.deepEqual(attachDate("2026-04-03", "2026-03-28", true), { ok: true, date: "2026-04-03" }); // keep statement
  assert.deepEqual(attachDate("2026-04-03", "2026-03-28", false), { ok: true, date: "2026-03-28" }); // use receipt
});

test("attachDate: a choice is ignored when nothing moves", () => {
  assert.deepEqual(attachDate("2026-02-22", "2026-02-08", true), { ok: true, date: "2026-02-08" });
});

test("attachDate: only a real boolean counts as a choice", () => {
  assert.deepEqual(attachDate("2026-04-03", "2026-03-28", "true" as unknown as boolean), {
    ok: false,
    code: "DATE_CHOICE_REQUIRED",
  });
});

test("attachDate: an invalid date is rejected", () => {
  assert.deepEqual(attachDate("2026-04-03", "March 28", false), { ok: false, code: "INVALID_DATE" });
  assert.deepEqual(attachDate("not a date", "2026-03-28", false), { ok: false, code: "INVALID_DATE" });
});
