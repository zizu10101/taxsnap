import { test } from "node:test";
import assert from "node:assert/strict";
import { everyPlanCapNote } from "./plan-cap-copy.ts";

test("employees: 1 on Free, up to 5 on Plus, unlimited on Pro", () => {
  assert.equal(
    everyPlanCapNote("employee", { free: 1, basic: 5, pro: null }),
    "Included on every plan: 1 employee on Free, up to 5 on Plus, unlimited on Pro.",
  );
});

test("pluralizes the Free number", () => {
  assert.equal(
    everyPlanCapNote("job", { free: 3, basic: 10, pro: null }),
    "Included on every plan: 3 jobs on Free, up to 10 on Plus, unlimited on Pro.",
  );
});

test("a capped Pro tier is stated as a cap, and an uncapped Free as unlimited", () => {
  assert.equal(
    everyPlanCapNote("job", { free: null, basic: null, pro: 50 }),
    "Included on every plan: unlimited jobs on Free, unlimited on Plus, up to 50 on Pro.",
  );
});
