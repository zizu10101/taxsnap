import { test } from "node:test";
import assert from "node:assert/strict";
import { saveReusableItems, savedItemsFailureMessage } from "./save-line-items.ts";

function fakeFetch(responses: { status: number; body?: unknown }[] | "throw") {
  const calls: { description: string }[] = [];
  let i = 0;
  const impl = (async (_url: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    if (responses === "throw") throw new TypeError("offline");
    const r = responses[i++];
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
  }) as typeof fetch;
  return { impl, calls };
}

test("all saved: nothing to report", async () => {
  const { impl, calls } = fakeFetch([{ status: 201 }, { status: 201 }]);
  const r = await saveReusableItems(
    [
      { description: "Paint", unit_price: 50 },
      { description: "Primer", unit_price: 20 },
    ],
    impl,
  );
  assert.deepEqual(r, { saved: 2, failures: [] });
  assert.equal(savedItemsFailureMessage(r), null);
  assert.deepEqual(
    calls.map((c) => c.description),
    ["Paint", "Primer"],
  );
});

test("a 403 plan cap is REPORTED, not swallowed, and the next item is still tried", async () => {
  const { impl } = fakeFetch([
    { status: 201 },
    { status: 403, body: { error: "You have reached your limit of 1 active saved item.", code: "FREE_LIMIT_REACHED" } },
  ]);
  const r = await saveReusableItems(
    [
      { description: "A", unit_price: 1 },
      { description: "B", unit_price: 2 },
    ],
    impl,
  );
  assert.equal(r.saved, 1);
  assert.equal(r.failures.length, 1);
  assert.match(savedItemsFailureMessage(r)!, /Saved 1, but 1 saved item couldn't be saved.*"B".*limit/);
});

test("a network error is reported per item", async () => {
  const { impl } = fakeFetch("throw");
  const r = await saveReusableItems([{ description: "A", unit_price: 1 }], impl);
  assert.equal(r.saved, 0);
  assert.match(savedItemsFailureMessage(r)!, /network error/);
});

test("requests run one at a time, in order", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const impl = (async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return new Response("{}", { status: 201 });
  }) as typeof fetch;
  await saveReusableItems(
    [1, 2, 3].map((n) => ({ description: `i${n}`, unit_price: n })),
    impl,
  );
  assert.equal(maxInFlight, 1);
});
