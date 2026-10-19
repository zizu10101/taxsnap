import { test } from "node:test";
import assert from "node:assert/strict";
import { everyPlanCapNote } from "./plan-cap-copy.ts";

test("employees: 1 on Free, unlimited on Pro", () => {
  assert.equal(
    everyPlanCapNote("employee", { free: 1, pro: null }),
    "Included on every plan: 1 employee on Free, unlimited on Pro.",
  );
});

test("pluralizes the Free number", () => {
  assert.equal(
    everyPlanCapNote("job", { free: 3, pro: null }),
    "Included on every plan: 3 jobs on Free, unlimited on Pro.",
  );
});

test("a capped Pro tier is stated as a cap, and an uncapped Free as unlimited", () => {
  assert.equal(
    everyPlanCapNote("job", { free: null, pro: 50 }),
    "Included on every plan: unlimited jobs on Free, up to 50 on Pro.",
  );
});
