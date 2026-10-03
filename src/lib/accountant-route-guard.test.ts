import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAccountantAccess, ACCOUNTANT_SESSION_TTL_DAYS } from "./accountant-route-guard.ts";
import { decideClientAccess } from "./client-route-guard.ts";
import { decideEmployeeAccess } from "./employee-route-guard.ts";

const valid = { hasAccountantCookie: true, accountantSessionValid: true, hasSupabaseUser: false };

function decide(pathname: string, over: Partial<typeof valid> = {}) {
  return decideAccountantAccess({ pathname, ...valid, ...over });
}

test("session lifetime is a fixed 14 days", () => {
  assert.equal(ACCOUNTANT_SESSION_TTL_DAYS, 14);
});

test("no cookie: everything passes through untouched", () => {
  for (const p of ["/", "/dashboard", "/api/documents", "/accountant/reports"]) {
    assert.deepEqual(
      decideAccountantAccess({
        pathname: p,
        hasAccountantCookie: false,
        accountantSessionValid: false,
        hasSupabaseUser: false,
      }),
      { action: "pass" },
    );
  }
});

test("owner session wins over a stale accountant cookie", () => {
  assert.deepEqual(decide("/dashboard", { hasSupabaseUser: true }), { action: "pass" });
});

test("invalid/expired cookie is cleared and the request continues anonymously", () => {
  assert.deepEqual(decide("/dashboard", { accountantSessionValid: false }), {
    action: "clear-cookie-and-pass",
  });
});

test("valid session: accountant pages and portal API pass", () => {
  for (const p of [
    "/accountant/reports",
    "/accountant/expenses",
    "/accountant/invoices/abc",
    "/accountant-login/sometoken",
    "/api/accountant-portal/reports",
    "/api/accountant-portal/some/future/route",
    "/icon",
  ]) {
    assert.deepEqual(decide(p), { action: "pass" }, p);
  }
});

test("valid session: every other page redirects to Reports", () => {
  for (const p of [
    "/",
    "/dashboard",
    "/dashboard/settings",
    "/dashboard/clients",
    "/dashboard/employees",
    "/billing",
    "/invoice/sometoken",
    "/sign/sometoken",
    "/client/documents",
    "/client-login/sometoken",
    "/employee/hours",
    "/employee-login/sometoken",
    "/admin",
    "/some/route/added/next/year",
  ]) {
    assert.deepEqual(decide(p), { action: "redirect", to: "/accountant/reports" }, p);
  }
});

test("valid session: every other API route is forbidden, including owner write routes", () => {
  for (const p of [
    "/api/documents",
    "/api/receipts",
    "/api/reports",
    "/api/clients",
    "/api/clients/abc/portal",
    "/api/employees",
    "/api/employee-login-link",
    "/api/accountant-access",
    "/api/client-portal/documents/abc",
    "/api/hours",
    "/api/expense-categories",
    "/api/bank-accounts",
  ]) {
    assert.deepEqual(decide(p), { action: "forbid" }, p);
  }
});

test("prefix matching is on whole segments", () => {
  assert.equal(decide("/accountants").action, "redirect");
  assert.equal(decide("/accountant-reports").action, "redirect");
  assert.equal(decide("/api/accountant-portalx/anything").action, "forbid");
  assert.equal(decide("/api/accountant-portal-evil").action, "forbid");
});

test("the other portals' sessions can't reach the accountant portal", () => {
  const client = decideClientAccess({
    pathname: "/accountant/reports",
    hasClientCookie: true,
    clientSessionValid: true,
    hasSupabaseUser: false,
  });
  assert.equal(client.action, "redirect");
  const employee = decideEmployeeAccess({
    pathname: "/api/accountant-portal/reports",
    hasEmployeeCookie: true,
    employeeSessionValid: true,
    hasSupabaseUser: false,
  });
  assert.equal(employee.action, "forbid");
});
