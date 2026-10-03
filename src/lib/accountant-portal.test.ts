import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Source-level guardrails for the accountant portal's "strictly read-only, one
// fixed scope" promise. They read the code, so a future edit that adds a write
// or an unscoped data route fails here and forces a conscious decision.

const SRC = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const apiRoot = join(SRC, "app", "api", "accountant-portal");
const routeFiles = walk(apiRoot).filter((f) => f.endsWith("route.ts"));
const rel = (f: string) => f.slice(SRC.length).replace(/\\/g, "/");

test("the accountant API has the routes we expect and no others", () => {
  const names = routeFiles.map(rel).sort();
  assert.deepEqual(names, [
    "app/api/accountant-portal/documents/[id]/route.ts",
    "app/api/accountant-portal/export-data/route.ts",
    "app/api/accountant-portal/export-data/signed-urls/route.ts",
    "app/api/accountant-portal/login/route.ts",
    "app/api/accountant-portal/logout/route.ts",
    "app/api/accountant-portal/receipts/[id]/image/route.ts",
    "app/api/accountant-portal/reports/detail/route.ts",
    "app/api/accountant-portal/reports/jobs/route.ts",
    "app/api/accountant-portal/reports/route.ts",
  ]);
});

test("every data route authenticates through getAccountantApiContext", () => {
  for (const file of routeFiles) {
    if (/\/(login|logout)\//.test(rel(file))) continue;
    const src = readFileSync(file, "utf8");
    assert.match(src, /getAccountantApiContext\(\)/, rel(file));
  }
});

test("data routes only expose GET, except the signed-url minting POST", () => {
  for (const file of routeFiles) {
    const name = rel(file);
    if (/\/(login|logout)\//.test(name)) continue;
    const src = readFileSync(file, "utf8");
    for (const verb of ["PUT", "PATCH", "DELETE"]) {
      assert.doesNotMatch(src, new RegExp(`export async function ${verb}\\b`), `${name} ${verb}`);
    }
    if (!name.endsWith("signed-urls/route.ts")) {
      assert.doesNotMatch(src, /export async function POST\b/, `${name} POST`);
    }
  }
});

test("no accountant-portal code writes to the database", () => {
  const files = [
    ...walk(apiRoot).filter((f) => !/\/(login|logout)\//.test(rel(f))),
    ...walk(join(SRC, "app", "accountant")),
    ...walk(join(SRC, "components", "accountant-portal")),
    join(SRC, "lib", "accountant-portal-server.ts"),
    join(SRC, "lib", "accountant-api.ts"),
    join(SRC, "lib", "accountant-page.ts"),
    join(SRC, "lib", "scoped-reader.ts"),
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /\.(insert|update|upsert|delete)\(/, rel(file));
    assert.doesNotMatch(src, /\.rpc\(/, rel(file));
  }
});

test("data routes and pages never open a raw table through the service client", () => {
  // The raw `admin` client is for storage signing and the business profile only;
  // data tables go through the scoped reader (ctx.db / ctx.db-based loaders).
  const files = [
    ...routeFiles.filter((f) => !/\/(login|logout)\//.test(rel(f))),
    ...walk(join(SRC, "app", "accountant")),
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /\badmin\s*\.\s*from\(/, `${rel(file)} reads a table via admin`);
    assert.doesNotMatch(src, /createServiceClient\(\)\s*\.\s*from\(/, rel(file));
  }
});

test("every accountant page checks the business is still available", () => {
  const pages = walk(join(SRC, "app", "accountant")).filter((f) => f.endsWith("page.tsx"));
  for (const file of pages) {
    if (rel(file) === "app/accountant/page.tsx") continue; // redirect only
    const src = readFileSync(file, "utf8");
    assert.match(src, /getAccountantPageContext\(\)/, rel(file));
    assert.match(src, /ctx\.available/, rel(file));
  }
});

test("the accountant session lifetime is fixed: expires_at is written once, at login", () => {
  const writers = walk(SRC).filter((f) => {
    if (!/\.(ts|tsx)$/.test(f) || /\.test\.ts$/.test(f)) return false;
    return /accountant_sessions/.test(readFileSync(f, "utf8")) && /\.(update|upsert)\(/.test(readFileSync(f, "utf8"));
  });
  assert.deepEqual(writers.map(rel), [], "nothing should update accountant_sessions");
  const login = readFileSync(join(apiRoot, "login", "route.ts"), "utf8");
  assert.equal((login.match(/expires_at:/g) ?? []).length, 1);
});
