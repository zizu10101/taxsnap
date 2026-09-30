import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Token-hash verify endpoint for links generated server-side (currently only
// the founder /admin "generate sign-in / reset link" action). Unlike
// /auth/callback, which exchanges a PKCE `code` tied to a verifier cookie in
// the browser that requested the email, an admin-generated link has no such
// browser - so this verifies the one-time token_hash directly and writes the
// session cookies on the redirect response.
//
// Only the two types /admin generates are accepted, and the destination is
// fixed per type (never taken from the query string), so this can't be used
// as an open redirect.
const DESTINATIONS: Partial<Record<EmailOtpType, string>> = {
  recovery: "/auth/reset-password",
  magiclink: "/dashboard",
};

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const destination = type ? DESTINATIONS[type] : undefined;

  if (tokenHash && type && destination) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      return NextResponse.redirect(`${origin}${destination}`);
    }
    console.error("[auth/confirm] verifyOtp failed:", error.message, error.status);
  }

  return NextResponse.redirect(
    `${origin}/auth?error=That link is invalid or has expired. Please request a new one.`,
  );
}
