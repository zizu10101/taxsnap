import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  PENDING_PLAN_COOKIE,
  POST_AUTH_REDIRECT_COOKIE,
  sanitizePendingPlan,
  sanitizeRedirectPath,
} from "@/lib/auth-redirect";
import { createCheckoutSessionUrl } from "@/lib/stripe-checkout";

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
  const pendingPlan = sanitizePendingPlan(cookieStore.get(PENDING_PLAN_COOKIE)?.value);

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // A "Get Started Basic/Pro" click on the landing page carries its
      // plan choice this far via PENDING_PLAN_COOKIE - send a genuinely
      // free account straight into Checkout for it instead of the
      // dashboard. Skipped for anyone already on a paid tier (an existing
      // Basic/Pro user re-authenticating through a stale cookie/link
      // shouldn't get bounced into creating another subscription) - falls
      // through to the normal redirect below in that case.
      if (pendingPlan && data.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("subscription_status")
          .eq("id", data.user.id)
          .single();

        if (!profile || profile.subscription_status === "free") {
          const checkoutUrl = await createCheckoutSessionUrl(
            supabase,
            data.user,
            pendingPlan,
            origin,
          );
          if (checkoutUrl) {
            const response = NextResponse.redirect(checkoutUrl);
            response.cookies.delete(POST_AUTH_REDIRECT_COOKIE);
            response.cookies.delete(PENDING_PLAN_COOKIE);
            return response;
          }
        }
      }

      const response = NextResponse.redirect(`${origin}${redirectTo}`);
      response.cookies.delete(POST_AUTH_REDIRECT_COOKIE);
      response.cookies.delete(PENDING_PLAN_COOKIE);
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
