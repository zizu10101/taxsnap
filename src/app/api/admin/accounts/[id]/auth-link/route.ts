import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { logAdminAction } from "@/lib/admin-data";
import { prepareAdminAction } from "@/lib/admin-route";

// Generates a one-time sign-in / password-reset link for the admin to hand
// to the user - nothing is emailed. The link goes through /auth/confirm
// (token_hash + verifyOtp on the server) rather than Supabase's own
// action_link: admin-generated links use the implicit flow (tokens in the
// URL hash), which /auth/callback's `code` exchange can't consume. The link
// is returned once in the response and NEVER logged - the audit row records
// only that one was generated.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const prep = await prepareAdminAction(request, ctx.params);
  if (prep instanceof NextResponse) return prep;
  const { admin, profile, body, reason } = prep;

  const kind = body.kind;
  if (kind !== "confirmation" && kind !== "recovery") {
    return NextResponse.json({ error: "Invalid link type" }, { status: 400 });
  }

  // "confirmation" uses a magiclink: signing in through one also marks the
  // email confirmed, which is what a resent confirmation email would do.
  const type = kind === "recovery" ? "recovery" : "magiclink";
  const { data, error } = await createAdminClient().auth.admin.generateLink({
    type,
    email: profile.email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    return NextResponse.json(
      { error: error?.message ?? "Couldn't generate a link." },
      { status: 500 },
    );
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const link = `${origin}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;

  const logError = await logAdminAction({
    accountId: profile.id,
    accountEmail: profile.email,
    adminId: admin.id,
    actionType: kind === "recovery" ? "password_reset" : "resend_confirmation",
    newValue: "link generated",
    reason,
  });
  if (logError) {
    return NextResponse.json(
      { error: `Link generated, but writing the audit log failed: ${logError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ link });
}
