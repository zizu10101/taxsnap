// Pure access decision for client-portal sessions. Same contract and same
// reasoning as employee-route-guard.ts: kept free of imports so it can be
// unit-tested with plain `node --test`, and proxy wiring (the cookie + DB
// lookup) lives in lib/supabase/middleware.ts.
//
// DEFAULT-DENY: once a request carries a valid client session (and no real
// Supabase user), every path is blocked unless it falls under a client
// prefix below. That includes the public /invoice/[token] and /sign/[token]
// pages - a client reads documents through /client/documents/[id] only, so
// the portal can never be used to reach the interactive signing flow.
// Anything added under a client prefix must call requireClientSession().

export const CLIENT_COOKIE = "ts_client_session";
export const CLIENT_HOME = "/client/documents";

// Matched on whole path segments ("/client-login" never matches "/client").
const CLIENT_PAGE_PREFIXES = ["/client", "/client-login"] as const;
const CLIENT_API_PREFIX = "/api/client-portal";

const ALWAYS_ALLOWED_EXACT = new Set(["/icon", "/apple-icon"]);

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

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
  const { pathname, hasClientCookie, clientSessionValid, hasSupabaseUser } = input;

  // A real owner session always wins - never lock the owner out because a
  // stale client cookie shares their browser (e.g. previewing a client's link).
  if (hasSupabaseUser) return { action: "pass" };
  if (!hasClientCookie) return { action: "pass" };
  if (!clientSessionValid) return { action: "clear-cookie-and-pass" };

  if (pathname.startsWith("/api/")) {
    return underPrefix(pathname, CLIENT_API_PREFIX) ? { action: "pass" } : { action: "forbid" };
  }

  if (ALWAYS_ALLOWED_EXACT.has(pathname)) return { action: "pass" };
  if (CLIENT_PAGE_PREFIXES.some((prefix) => underPrefix(pathname, prefix))) {
    return { action: "pass" };
  }

  return { action: "redirect", to: CLIENT_HOME };
}
