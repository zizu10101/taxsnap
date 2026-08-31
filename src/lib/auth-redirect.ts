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
