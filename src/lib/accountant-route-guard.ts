// Access decision for accountant-portal sessions. The default-deny logic is the
// shared one in portal-route-guard.ts; this file only names the accountant
// portal's cookie, prefixes and home page. proxy wiring lives in
// lib/supabase/middleware.ts.
//
// Anything added under these prefixes must call requireAccountantSession().

import { decidePortalAccess, type PortalGuardConfig } from "./portal-route-guard.ts";

export const ACCOUNTANT_COOKIE = "ts_accountant_session";
export const ACCOUNTANT_HOME = "/accountant/reports";

// Fixed from sign-in, deliberately shorter than the employee/client portals'
// 30 days: an accountant works in bursts and sees every financial record.
export const ACCOUNTANT_SESSION_TTL_DAYS = 14;

const CONFIG: PortalGuardConfig = {
  pagePrefixes: ["/accountant", "/accountant-login"],
  apiPrefix: "/api/accountant-portal",
  home: ACCOUNTANT_HOME,
};

export type AccountantGuardInput = {
  pathname: string;
  hasAccountantCookie: boolean;
  // Only meaningful when hasAccountantCookie. Looked up by the caller.
  accountantSessionValid: boolean;
  hasSupabaseUser: boolean;
};

export type AccountantGuardDecision =
  | { action: "pass" }
  // Cookie present but no longer valid: drop it, then continue as anonymous.
  | { action: "clear-cookie-and-pass" }
  | { action: "redirect"; to: string }
  | { action: "forbid" };

export function decideAccountantAccess(input: AccountantGuardInput): AccountantGuardDecision {
  return decidePortalAccess(CONFIG, {
    pathname: input.pathname,
    hasCookie: input.hasAccountantCookie,
    sessionValid: input.accountantSessionValid,
    hasSupabaseUser: input.hasSupabaseUser,
  });
}
