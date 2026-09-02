// Where to send the user after a magic-link, OAuth, or signup-confirmation
// round trip through Supabase's own /auth/v1/verify or /auth/v1/authorize
// endpoint. Supabase's Redirect URLs allow-list only reliably matches the
// *exact* emailRedirectTo/redirectTo URL it was given - appending a
// `?redirectTo=...` query string to carry the final destination stops
// matching the configured allow-list entries (confirmed empirically: an
// exact `/auth/callback` entry and a `/auth/callback/*` wildcard both fail
// to match once a query string is appended), and Supabase silently falls
// back to the bare Site URL instead of erroring - losing the destination
// entirely. So the destination can't ride along in that URL at all.
//
// A cookie set before the request survives the round trip through
// Supabase's domain untouched, since it's scoped to our own origin and
// entirely unrelated to Supabase's allow-list matching - emailRedirectTo/
// redirectTo can then always point at the bare `${origin}/auth/callback`,
// which matches the allow-list's exact entry every time.
export const POST_AUTH_REDIRECT_COOKIE = "post_auth_redirect";

export function setPostAuthRedirect(path: string) {
  document.cookie = `${POST_AUTH_REDIRECT_COOKIE}=${encodeURIComponent(path)}; path=/; max-age=600; SameSite=Lax`;
}

// Guards against an open redirect if this cookie's value were ever
// tampered with - only a same-origin relative path is ever a valid
// destination, so anything else (an absolute URL, a protocol-relative
// `//host` path) falls back to the default rather than being followed.
export function sanitizeRedirectPath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/dashboard";
  return path;
}

// Same cookie-round-trip reasoning as POST_AUTH_REDIRECT_COOKIE above -
// carries the plan a "Get Started" click on the landing page's pricing
// section was for (?plan=basic/pro on /auth) across the same Supabase
// domain round trip, so /auth/callback can send a brand-new signup
// straight into Stripe Checkout for that plan instead of the dashboard.
export const PENDING_PLAN_COOKIE = "pending_plan";

export function setPendingPlan(tier: string | null) {
  if (tier !== "basic" && tier !== "pro") return;
  document.cookie = `${PENDING_PLAN_COOKIE}=${tier}; path=/; max-age=600; SameSite=Lax`;
}

export function sanitizePendingPlan(value: string | null | undefined): "basic" | "pro" | null {
  return value === "basic" || value === "pro" ? value : null;
}

// Same cookie-round-trip reasoning again, for a "Get Started" click on
// /salons's ?business=salon - Google OAuth can't carry custom signup data
// through its own handshake the way signUp()/signInWithOtp()'s `data`
// option can (those two set business_type directly at row-creation time,
// no cookie needed), so a Google signup's salon intent has to survive
// until /auth/choose-business-type renders, to pre-select the toggle
// there instead of defaulting to General.
export const PENDING_BUSINESS_TYPE_COOKIE = "pending_business_type";

export function setPendingBusinessType(businessType: string | null) {
  if (businessType !== "salon") return;
  document.cookie = `${PENDING_BUSINESS_TYPE_COOKIE}=salon; path=/; max-age=600; SameSite=Lax`;
}

export function sanitizePendingBusinessType(value: string | null | undefined): "salon" | null {
  return value === "salon" ? "salon" : null;
}
