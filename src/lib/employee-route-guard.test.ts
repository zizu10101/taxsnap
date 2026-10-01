import { test } from "node:test";
import assert from "node:assert/strict";
import { decideEmployeeAccess } from "./employee-route-guard.ts";

const valid = { hasEmployeeCookie: true, employeeSessionValid: true, hasSupabaseUser: false };

function decide(pathname: string, over: Partial<typeof valid> = {}) {
  return decideEmployeeAccess({ pathname, ...valid, ...over });
}

test("no cookie: everything passes through untouched", () => {
  for (const p of ["/", "/dashboard", "/api/receipts", "/employee/hours"]) {
    assert.deepEqual(
      decideEmployeeAccess({
        pathname: p,
        hasEmployeeCookie: false,
        employeeSessionValid: false,
        hasSupabaseUser: false,
      }),
      { action: "pass" },
    );
  }
});

test("owner session wins over a stale employee cookie", () => {
  assert.deepEqual(decide("/dashboard", { hasSupabaseUser: true }), { action: "pass" });
});

test("invalid/expired cookie is cleared and the request continues anonymously", () => {
  assert.deepEqual(decide("/dashboard", { employeeSessionValid: false }), {
    action: "clear-cookie-and-pass",
  });
});

test("valid session: employee pages and portal API pass", () => {
  for (const p of [
    "/employee/hours",
    "/employee/anything/new/in/future",
    "/employee-login/abc123",
    "/api/employee-portal/clock-in",
    "/api/employee-portal/some/future/route",
    "/icon",
  ]) {
    assert.deepEqual(decide(p), { action: "pass" }, p);
  }
});

test("valid session: every other page redirects to the hours view", () => {
  for (const p of [
    "/",
    "/dashboard",
    "/dashboard/employees",
    "/dashboard/settings",
    "/billing",
    "/invoices",
    "/invoice/sometoken",
    "/sign/sometoken",
    "/admin",
    "/auth",
    "/onboarding",
    "/some/route/added/next/year",
  ]) {
    assert.deepEqual(decide(p), { action: "redirect", to: "/employee/hours" }, p);
  }
});

test("valid session: every other API route is forbidden (JSON 403, not a redirect)", () => {
  for (const p of [
    "/api/receipts",
    "/api/documents",
    "/api/hours",
    "/api/employees",
    "/api/time-sessions",
    "/api/employee-login-link",
    "/api/parse-receipt",
  ]) {
    assert.deepEqual(decide(p), { action: "forbid" }, p);
  }
});

test("prefix matching is on whole segments", () => {
  assert.equal(decide("/employees").action, "redirect");
  assert.equal(decide("/employee-hours").action, "redirect");
  assert.equal(decide("/employeeX/hours").action, "redirect");
  assert.equal(decide("/api/employee-portalx/anything").action, "forbid");
  assert.equal(decide("/api/employee-portal-evil").action, "forbid");
});
