// Pure access decision for employee-portal sessions. Kept free of imports so
// it can be unit-tested with plain `node --test` (see employee-route-guard.test.ts)
// and so proxy.ts is the only place wiring it to real cookies/DB lookups.
//
// DEFAULT-DENY: once a request carries a valid employee session (and no real
// Supabase user), every path is blocked unless it falls under one of the
// employee prefixes below. A route added tomorrow anywhere else is therefore
// unreachable to an employee without anyone remembering to protect it. And
// anything added under an employee prefix is only ever served to a request
// that already has a valid session - the proxy validates it before the route
// runs, and requireEmployeeSession() re-checks inside every handler.

export const EMPLOYEE_COOKIE = "ts_emp_session";
export const EMPLOYEE_HOME = "/employee/hours";

// Matched on whole path segments (so "/employee-login" never matches
// "/employee", and "/employeesomething" matches neither).
const EMPLOYEE_PAGE_PREFIXES = ["/employee", "/employee-login"] as const;
const EMPLOYEE_API_PREFIX = "/api/employee-portal";

// Non-navigational assets the app shell fetches on every page. Everything
// else (including "/") is blocked.
const ALWAYS_ALLOWED_EXACT = new Set(["/icon", "/apple-icon"]);

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

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
  const { pathname, hasEmployeeCookie, employeeSessionValid, hasSupabaseUser } = input;

  // A real owner session always wins - never lock the owner out of the app
  // because a stale employee cookie happens to share their browser.
  if (hasSupabaseUser) return { action: "pass" };
  if (!hasEmployeeCookie) return { action: "pass" };
  if (!employeeSessionValid) return { action: "clear-cookie-and-pass" };

  if (pathname.startsWith("/api/")) {
    return underPrefix(pathname, EMPLOYEE_API_PREFIX) ? { action: "pass" } : { action: "forbid" };
  }

  if (ALWAYS_ALLOWED_EXACT.has(pathname)) return { action: "pass" };
  if (EMPLOYEE_PAGE_PREFIXES.some((prefix) => underPrefix(pathname, prefix))) {
    return { action: "pass" };
  }

  return { action: "redirect", to: EMPLOYEE_HOME };
}
