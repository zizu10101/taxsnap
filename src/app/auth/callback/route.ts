import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { POST_AUTH_REDIRECT_COOKIE, sanitizeRedirectPath } from "@/lib/auth-redirect";

// Handles the magic-link / OAuth / signup-confirmation redirect: exchanges
// the `code` param for a session and drops the user on their intended
// destination. The destination travels via a cookie, not a `redirectTo`
// query param on this route's own URL - see lib/auth-redirect.ts for why:
// Supabase's Redirect URLs allow-list stopped matching this URL entirely
// once a query string was appended, silently falling back to the bare Site
// URL and losing the destination.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const cookieStore = await cookies();
  const redirectTo = sanitizeRedirectPath(
    cookieStore.get(POST_AUTH_REDIRECT_COOKIE)?.value ?? searchParams.get("redirectTo"),
  );

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${redirectTo}`);
      response.cookies.delete(POST_AUTH_REDIRECT_COOKIE);
      return response;
    }
    // Logged server-side (not surfaced to the client) purely for debugging
    // the Resend-switch magic-link regression - exchangeCodeForSession's
    // real error (expired/already-used code, PKCE verifier mismatch, etc.)
    // was previously discarded entirely in favor of the generic message
    // below, making it impossible to tell *why* a real attempt failed.
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message, error.status);
  } else {
    console.error("[auth/callback] no code param on callback request:", request.url);
  }

  return NextResponse.redirect(
    `${origin}/auth?error=Could not authenticate. Please try again.`,
  );
}
