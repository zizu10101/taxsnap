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
  ["invoices/document-detail", "document"],
  ["invoices/document-workstation", "documents"],
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

// ---- The Invoices-tab hydration bug: a prop that is a NEW object on every render ----
//
// useSyncedState re-seeds whenever it is handed a different object. A default written in the
// parameter list (`convertedMap = {}`) is a different object on every render, so a component that
// renders twice (React's dev StrictMode double render, any later re-render) loops until React throws
// "Too many re-renders". The server renderer renders once, so the HTML looked fine; on the client
// the throw during hydration made React client-render the whole document (which is what logs
// "Encountered a script tag while rendering React component").

test("a prop that is a fresh object on every render never settles (what `x = {}` in a signature does)", () => {
  const h = createHarness((p: { v?: Record<string, string> }) => {
    const { v = {} } = p; // new {} each call
    return useSyncedState(v);
  });
  h.render({}); // first render: fine
  assert.throws(() => h.render({}), /Too many re-renders/);
});

test("a stable fallback constant settles however often it re-renders", () => {
  const NONE: Record<string, string> = {};
  const h = createHarness((p: { v?: Record<string, string> }) => useSyncedState(p.v ?? NONE));
  for (let i = 0; i < 5; i++) assert.equal(h.render({})[0], NONE);
});

test("no component gives its synced prop a fresh default (`= {}`, `= []`, `= new ...`)", () => {
  const files = new Set([...SYNCED.map(([f]) => f), "invoices/document-list", "invoices/document-workstation"]);
  for (const file of files) {
    const src = readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(
      src,
      /^\s*(initial\w+|convertedMap|document|clients)\s*=\s*(\{\}|\[\]|new\s)/m,
      `${file} defaults a synced prop to a new object on every render`,
    );
  }
});

test("invoices/document-list seeds convertedMap from a stable fallback", () => {
  const src = readFileSync(new URL("../components/invoices/document-list.tsx", import.meta.url), "utf8");
  assert.match(src, /useSyncedState\(convertedMap \?\? NO_CONVERSIONS\)/);
  assert.match(src, /^const NO_CONVERSIONS: Record<string, string> = \{\};/m);
});
