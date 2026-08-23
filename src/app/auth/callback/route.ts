import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles the magic-link / OAuth redirect: exchanges the `code` param for a
// session and drops the user on their intended destination.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") || "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/auth?error=Could not authenticate. Please try again.`,
  );
}
