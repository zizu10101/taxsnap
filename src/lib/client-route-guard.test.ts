import { test } from "node:test";
import assert from "node:assert/strict";
import { decideClientAccess } from "./client-route-guard.ts";

const valid = { hasClientCookie: true, clientSessionValid: true, hasSupabaseUser: false };

function decide(pathname: string, over: Partial<typeof valid> = {}) {
  return decideClientAccess({ pathname, ...valid, ...over });
}

test("no cookie: everything passes through untouched", () => {
  for (const p of ["/", "/dashboard", "/api/documents", "/client/documents"]) {
    assert.deepEqual(
      decideClientAccess({
        pathname: p,
        hasClientCookie: false,
        clientSessionValid: false,
        hasSupabaseUser: false,
      }),
      { action: "pass" },
    );
  }
});

test("owner session wins over a stale client cookie", () => {
  assert.deepEqual(decide("/dashboard", { hasSupabaseUser: true }), { action: "pass" });
});

test("invalid/expired cookie is cleared and the request continues anonymously", () => {
  assert.deepEqual(decide("/dashboard", { clientSessionValid: false }), {
    action: "clear-cookie-and-pass",
  });
});

test("valid session: client pages and portal API pass", () => {
  for (const p of [
    "/client/documents",
    "/client/documents/abc",
    "/client-login/sometoken",
    "/api/client-portal/logout",
    "/api/client-portal/some/future/route",
    "/icon",
  ]) {
    assert.deepEqual(decide(p), { action: "pass" }, p);
  }
});

test("valid session: every other page redirects to the portal home", () => {
  for (const p of [
    "/",
    "/dashboard",
    "/dashboard/clients",
    "/billing",
    "/invoice/sometoken",
    "/sign/sometoken",
    "/employee/hours",
    "/employee-login/sometoken",
    "/auth",
    "/admin",
    "/some/route/added/next/year",
  ]) {
    assert.deepEqual(decide(p), { action: "redirect", to: "/client/documents" }, p);
  }
});

test("valid session: every other API route is forbidden (JSON 403, not a redirect)", () => {
  for (const p of [
    "/api/documents",
    "/api/clients",
    "/api/jobs",
    "/api/receipts",
    "/api/employee-portal/clock-in",
    "/api/sign/sometoken",
  ]) {
    assert.deepEqual(decide(p), { action: "forbid" }, p);
  }
});

test("prefix matching is on whole segments", () => {
  assert.equal(decide("/clients").action, "redirect");
  assert.equal(decide("/client-documents").action, "redirect");
  assert.equal(decide("/clientX/documents").action, "redirect");
  assert.equal(decide("/api/client-portalx/anything").action, "forbid");
  assert.equal(decide("/api/client-portal-evil").action, "forbid");
});
