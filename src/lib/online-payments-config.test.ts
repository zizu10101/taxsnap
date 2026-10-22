import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isOnlinePaymentsEnabled, parseOnlinePaymentsAllowlist } from "./online-payments-config.ts";

test("open to everyone when the allowlist is unset or empty", () => {
  assert.equal(isOnlinePaymentsEnabled("a@x.com", undefined), true);
  assert.equal(isOnlinePaymentsEnabled("a@x.com", null), true);
  assert.equal(isOnlinePaymentsEnabled("a@x.com", ""), true);
  assert.equal(isOnlinePaymentsEnabled("a@x.com", " , "), true);
  assert.equal(isOnlinePaymentsEnabled(null, ""), true);
});

test("when set, only listed emails pass, case- and space-insensitively", () => {
  const raw = " Info+Test2@EdgeDBS.com , b@x.com ";
  assert.equal(isOnlinePaymentsEnabled("info+test2@edgedbs.com", raw), true);
  assert.equal(isOnlinePaymentsEnabled(" B@X.COM ", raw), true);
  assert.equal(isOnlinePaymentsEnabled("c@x.com", raw), false);
  assert.equal(isOnlinePaymentsEnabled("info@edgedbs.com", raw), false);
});

test("when set, a missing email is refused and there is no wildcard", () => {
  assert.equal(isOnlinePaymentsEnabled(null, "a@x.com"), false);
  assert.equal(isOnlinePaymentsEnabled(undefined, "a@x.com"), false);
  assert.equal(isOnlinePaymentsEnabled("a@x.com", "*"), false);
  assert.equal(parseOnlinePaymentsAllowlist("*").has("*"), true);
});

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("owner-side entry points are gated", () => {
  for (const p of [
    "../app/api/stripe/connect/start/route.ts",
    "../app/api/stripe/connect/refresh/route.ts",
    "../app/api/profile/stripe-fee-expenses/route.ts",
    "../app/(app)/dashboard/settings/page.tsx",
  ]) {
    assert.match(read(p), /isOnlinePaymentsEnabled\(/, p);
  }
});

test("public Pay now, its checkout route and the webhooks never consult the allowlist", () => {
  for (const p of [
    "../app/invoice/[token]/page.tsx",
    "../app/api/public/invoice/[token]/checkout/route.ts",
    "../app/api/stripe/connect-webhook/route.ts",
    "./online-payments.ts",
    "./online-refunds.ts",
  ]) {
    assert.doesNotMatch(read(p), /online-payments-config|isOnlinePaymentsEnabled/, p);
  }
});
