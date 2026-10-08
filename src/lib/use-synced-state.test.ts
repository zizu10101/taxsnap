import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { shouldResync, useSyncedState } from "./use-synced-state.ts";

// A minimal hook runner: installs a fake React dispatcher whose useState keeps
// slots by call order, and re-runs the function while it set state DURING
// render (exactly what React does for render-phase updates). That exercises
// the real useSyncedState without a DOM.
type Internals = { H: unknown };
const internals = (
  React as unknown as { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: Internals }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

function createHarness<P, R>(hookBody: (props: P) => R) {
  const slots: unknown[] = [];
  let renders = 0;
  let renderPhaseUpdate = false;
  let currentProps!: P;

  function run(): R {
    let i = 0;
    internals.H = {
      useState<S>(init: S | (() => S)) {
        const idx = i++;
        if (!(idx in slots)) slots[idx] = typeof init === "function" ? (init as () => S)() : init;
        const set = (v: S | ((p: S) => S)) => {
          const next = typeof v === "function" ? (v as (p: S) => S)(slots[idx] as S) : v;
          if (!Object.is(next, slots[idx])) {
            slots[idx] = next;
            renderPhaseUpdate = true;
          }
        };
        return [slots[idx] as S, set];
      },
    };
    renders += 1;
    return hookBody(currentProps);
  }

  function render(props: P): R {
    currentProps = props;
    for (let pass = 0; pass < 25; pass++) {
      renderPhaseUpdate = false;
      const result = run();
      if (!renderPhaseUpdate) {
        internals.H = null;
        return result;
      }
    }
    throw new Error("Too many re-renders (render-phase update never settled)");
  }
  return {
    render,
    get renders() {
      return renders;
    },
  };
}

test("shouldResync: only a different reference re-seeds", () => {
  const a = [1];
  assert.equal(shouldResync(a, a), false);
  assert.equal(shouldResync(a, [1]), true);
  assert.equal(shouldResync(null, null), false);
});

test("starts from the prop", () => {
  const h = createHarness((p: { v: string[] }) => useSyncedState(p.v));
  assert.deepEqual(h.render({ v: ["a"] })[0], ["a"]);
});

test("a NEW prop (what router.refresh() hands down) replaces the list", () => {
  const h = createHarness((p: { v: string[] }) => useSyncedState(p.v));
  const first = ["a"];
  h.render({ v: first });
  const [same] = h.render({ v: first });
  assert.equal(same, first);
  const fresh = ["a", "b-saved-elsewhere"];
  assert.deepEqual(h.render({ v: fresh })[0], fresh);
});

test("a local (optimistic) edit sticks while the prop is unchanged", () => {
  const h = createHarness((p: { v: string[] }) => useSyncedState(p.v));
  const server = ["a"];
  const [, set] = h.render({ v: server });
  set((prev) => [...prev, "local"]);
  assert.deepEqual(h.render({ v: server })[0], ["a", "local"]);
});

test("fresh server data wins over an earlier local edit", () => {
  const h = createHarness((p: { v: string[] }) => useSyncedState(p.v));
  const [, set] = h.render({ v: ["a"] });
  set(["a", "local"]);
  assert.deepEqual(h.render({ v: ["a", "local", "server-extra"] })[0], ["a", "local", "server-extra"]);
});

test("settles after one extra pass, not a loop", () => {
  const h = createHarness((p: { v: string[] }) => useSyncedState(p.v));
  h.render({ v: ["a"] });
  const before = h.renders;
  h.render({ v: ["b"] });
  assert.equal(h.renders - before, 2);
});

// Every list that used to copy its prop into plain useState and never follow
// it. If one is turned back into `useState(initialX)`, a router.refresh()
// stops updating it again.
const SYNCED: [file: string, prop: string][] = [
  ["clients/client-list", "initialClients"],
  ["clients/client-detail", "initialClient"],
  ["dashboard/dashboard-body", "initialReceipts"],
  ["dashboard/expenses-body", "initialReceipts"],
  ["dashboard/expenses-body", "initialTemplates"],
  ["employees/employee-list", "initialEmployees"],
  ["hours/hours-list", "initialEntries"],
  ["hours/hours-list", "initialEmployees"],
  ["hours/hours-list", "initialJobs"],
  ["invoices/business-profile-card", "initialProfile"],
  ["invoices/line-item-list", "initialLineItems"],
  ["invoices/document-list", "convertedMap"],
  ["invoices/document-detail", "document"],
  ["jobs/job-detail", "initialHourEntries"],
  ["jobs/job-list", "initialJobs"],
  ["rentals/rentals-client", "initialRenters"],
  ["commission/product-list", "initialProducts"],
  ["commission/service-list", "initialServices"],
  ["commission/stylist-list", "initialStylists"],
];

for (const [file, prop] of SYNCED) {
  test(`${file} follows its ${prop} prop`, () => {
    const src = readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), "utf8");
    assert.match(src, new RegExp(`useSyncedState\\(${prop}\\)`), "uses useSyncedState");
    assert.doesNotMatch(src, new RegExp(`useState\\(${prop}\\)`), "no plain useState seed left");
  });
}
