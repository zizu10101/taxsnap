// Access decision for employee-portal sessions. The default-deny logic is the
// shared one in portal-route-guard.ts (unit-tested there and in
// employee-route-guard.test.ts); this file only names the employee portal's
// cookie, prefixes and home page. proxy wiring lives in lib/supabase/middleware.ts.
//
// Anything added *under* these prefixes must call requireEmployeeSession().

import { decidePortalAccess, type PortalGuardConfig } from "./portal-route-guard.ts";

export const EMPLOYEE_COOKIE = "ts_emp_session";
export const EMPLOYEE_HOME = "/employee/hours";

const CONFIG: PortalGuardConfig = {
  pagePrefixes: ["/employee", "/employee-login"],
  apiPrefix: "/api/employee-portal",
  home: EMPLOYEE_HOME,
};

export type EmployeeGuardInput = {
  pathname: string;
  hasEmployeeCookie: boolean;
  // Only meaningful when hasEmployeeCookie. Looked up by the caller.
  employeeSessionValid: boolean;
  hasSupabaseUser: boolean;
};

export type EmployeeGuardDecision =
  | { action: "pass" }
  // Cookie present but no longer valid: drop it, then continue as anonymous.
  | { action: "clear-cookie-and-pass" }
  | { action: "redirect"; to: string }
  | { action: "forbid" };

export function decideEmployeeAccess(input: EmployeeGuardInput): EmployeeGuardDecision {
  return decidePortalAccess(CONFIG, {
    pathname: input.pathname,
    hasCookie: input.hasEmployeeCookie,
    sessionValid: input.employeeSessionValid,
    hasSupabaseUser: input.hasSupabaseUser,
  });
}
