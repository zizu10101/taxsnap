import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

// public/sw-routing.js is plain CommonJS-compatible JS (the worker loads it
// with importScripts), so it is required rather than imported.
const require = createRequire(import.meta.url);
const { decideFetchStrategy } = require("../../public/sw-routing.js") as {
  decideFetchStrategy: (
    req: {
      method: string;
      url: string;
      mode?: string;
      destination?: string;
      headers: { get(name: string): string | null };
    },
    origin: string,
  ) => "bypass" | "network-only" | "network-first" | "cache";
};

const ORIGIN = "https://gettaxsnap.ca";

function req(
  url: string,
  opts: { method?: string; mode?: string; destination?: string; headers?: Record<string, string> } = {},
) {
  const headers = new Map(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    method: opts.method ?? "GET",
    url,
    mode: opts.mode ?? "cors",
    destination: opts.destination ?? "",
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
  };
}

test("RSC requests are never cached: the rsc header", () => {
  assert.equal(
    decideFetchStrategy(req(`${ORIGIN}/dashboard/invoices`, { headers: { RSC: "1" } }), ORIGIN),
    "network-only",
  );
});

test("RSC requests are never cached: the _rsc cache-busting param", () => {
  assert.equal(decideFetchStrategy(req(`${ORIGIN}/dashboard/jobs?_rsc=1ab2c`), ORIGIN), "network-only");
});

test("RSC requests are never cached: router state tree / prefetch headers", () => {
  for (const h of ["Next-Router-State-Tree", "Next-Router-Prefetch", "Next-Router-Segment-Prefetch"]) {
    assert.equal(
      decideFetchStrategy(req(`${ORIGIN}/dashboard/hours`, { headers: { [h]: "1" } }), ORIGIN),
      "network-only",
      h,
    );
  }
});

test("the router.refresh() request shape (mode cors, rsc + _rsc) is network-only, not cache-first", () => {
  const r = req(`${ORIGIN}/dashboard/estimates/new?_rsc=xyz`, {
    mode: "cors",
    headers: { rsc: "1", "next-router-state-tree": "%5B%22%22%5D" },
  });
  assert.equal(decideFetchStrategy(r, ORIGIN), "network-only");
});

test("legacy page-data (/_next/data/) is network-only", () => {
  assert.equal(decideFetchStrategy(req(`${ORIGIN}/_next/data/abc/dashboard.json`), ORIGIN), "network-only");
});

test("an RSC request that claims mode=navigate is still network-only (RSC check wins)", () => {
  assert.equal(
    decideFetchStrategy(req(`${ORIGIN}/dashboard?_rsc=1`, { mode: "navigate" }), ORIGIN),
    "network-only",
  );
});

test("full page loads stay network-first with the cache as offline fallback", () => {
  assert.equal(decideFetchStrategy(req(`${ORIGIN}/dashboard`, { mode: "navigate" }), ORIGIN), "network-first");
});

test("static assets are still cached", () => {
  for (const path of [
    "/_next/static/chunks/abc.js",
    "/_next/static/css/app.css",
    "/_next/image?url=%2Fx.png&w=64&q=75",
    "/icons/icon-192",
    "/manifest.json",
    "/logo-mark.png",
  ]) {
    assert.equal(decideFetchStrategy(req(`${ORIGIN}${path}`), ORIGIN), "cache", path);
  }
  assert.equal(
    decideFetchStrategy(req(`${ORIGIN}/fonts/x.woff2`, { destination: "font" }), ORIGIN),
    "cache",
  );
});

test("a non-asset same-origin GET is not assumed to be static", () => {
  assert.equal(decideFetchStrategy(req(`${ORIGIN}/dashboard/invoices/123`), ORIGIN), "network-only");
});

test("API calls and non-GET requests are not intercepted", () => {
  assert.equal(decideFetchStrategy(req(`${ORIGIN}/api/documents`), ORIGIN), "bypass");
  assert.equal(decideFetchStrategy(req(`${ORIGIN}/dashboard`, { method: "POST" }), ORIGIN), "bypass");
});

test("cross-origin requests (Supabase REST, signed storage URLs) are not cached", () => {
  assert.equal(
    decideFetchStrategy(req("https://abc.supabase.co/rest/v1/receipts?select=*"), ORIGIN),
    "bypass",
  );
  assert.equal(
    decideFetchStrategy(req("https://abc.supabase.co/storage/v1/object/sign/receipts/x.jpg?token=t"), ORIGIN),
    "bypass",
  );
});

test("sw.js uses the routing function and a bumped cache name", () => {
  const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
  assert.match(sw, /importScripts\("\/sw-routing\.js"\)/);
  assert.match(sw, /decideFetchStrategy/);
  assert.match(sw, /CACHE_NAME = "taxsnap-shell-v3"/);
  assert.match(sw, /skipWaiting\(\)/);
  assert.match(sw, /clients\.claim\(\)/);
  // The old rule keyed on mode === "navigate" alone must not come back.
  assert.doesNotMatch(sw, /request\.mode === "navigate"/);
});
