// Access decision for client-portal sessions. The default-deny logic is the
// shared one in portal-route-guard.ts; this file only names the client portal's
// cookie, prefixes and home page. proxy wiring lives in lib/supabase/middleware.ts.
//
// Default-deny includes the public /invoice/[token] and /sign/[token] pages: a
// client reads documents through /client/documents/[id] only, so the portal can
// never be used to reach the interactive signing flow. Anything added under a
// client prefix must call requireClientSession().

import { decidePortalAccess, type PortalGuardConfig } from "./portal-route-guard.ts";

export const CLIENT_COOKIE = "ts_client_session";
export const CLIENT_HOME = "/client/documents";

const CONFIG: PortalGuardConfig = {
  pagePrefixes: ["/client", "/client-login"],
  apiPrefix: "/api/client-portal",
  home: CLIENT_HOME,
};

export type ClientGuardInput = {
  pathname: string;
  hasClientCookie: boolean;
  // Only meaningful when hasClientCookie. Looked up by the caller.
  clientSessionValid: boolean;
  hasSupabaseUser: boolean;
};

export type ClientGuardDecision =
  | { action: "pass" }
  // Cookie present but no longer valid: drop it, then continue as anonymous.
  | { action: "clear-cookie-and-pass" }
  | { action: "redirect"; to: string }
  | { action: "forbid" };

export function decideClientAccess(input: ClientGuardInput): ClientGuardDecision {
  return decidePortalAccess(CONFIG, {
    pathname: input.pathname,
    hasCookie: input.hasClientCookie,
    sessionValid: input.clientSessionValid,
    hasSupabaseUser: input.hasSupabaseUser,
  });
}
