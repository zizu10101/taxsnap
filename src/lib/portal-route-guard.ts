// The one default-deny decision shared by every cookie-session portal
// (employee clock-in, client, accountant). Pure and import-free so it unit-
// tests with plain `node --test`; each portal's own *-route-guard.ts supplies
// its prefixes and home page and re-exports a thin, named wrapper.
//
// DEFAULT-DENY: once a request carries a valid portal session (and no real
// Supabase user), every path is blocked unless it falls under that portal's
// own prefixes. A route added tomorrow anywhere else is therefore unreachable
// to a portal session without anyone remembering to protect it.

export interface PortalGuardConfig {
  // Matched on whole path segments ("/client-login" never matches "/client").
  pagePrefixes: readonly string[];
  apiPrefix: string;
  // Where a valid session is sent when it asks for anything else.
  home: string;
}

export type PortalGuardInput = {
  pathname: string;
  hasCookie: boolean;
  // Only meaningful when hasCookie. Looked up by the caller.
  sessionValid: boolean;
  hasSupabaseUser: boolean;
};

export type PortalGuardDecision =
  | { action: "pass" }
  // Cookie present but no longer valid: drop it, then continue as anonymous.
  | { action: "clear-cookie-and-pass" }
  | { action: "redirect"; to: string }
  | { action: "forbid" };

// Non-navigational assets the app shell fetches on every page.
const ALWAYS_ALLOWED_EXACT = new Set(["/icon", "/apple-icon"]);

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export function decidePortalAccess(
  config: PortalGuardConfig,
  input: PortalGuardInput,
): PortalGuardDecision {
  const { pathname, hasCookie, sessionValid, hasSupabaseUser } = input;

  // A real owner session always wins - never lock the owner out of the app
  // because a stale portal cookie happens to share their browser.
  if (hasSupabaseUser) return { action: "pass" };
  if (!hasCookie) return { action: "pass" };
  if (!sessionValid) return { action: "clear-cookie-and-pass" };

  if (pathname.startsWith("/api/")) {
    return underPrefix(pathname, config.apiPrefix) ? { action: "pass" } : { action: "forbid" };
  }

  if (ALWAYS_ALLOWED_EXACT.has(pathname)) return { action: "pass" };
  if (config.pagePrefixes.some((prefix) => underPrefix(pathname, prefix))) {
    return { action: "pass" };
  }

  return { action: "redirect", to: config.home };
}
