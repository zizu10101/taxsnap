import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Set a new password — TaxSnap",
};

// resetPasswordForEmail's redirectTo points directly here (a bare path, no
// query string) instead of bouncing through /auth/callback?redirectTo=...
// like magic-link/OAuth do - Supabase's Redirect URLs allow-list matching
// (at least for a wildcard entry, observed directly against this project)
// doesn't reliably preserve a query string appended to the requested
// redirect URL, silently truncating it to the bare origin instead of
// erroring. Exchanging the code inline here, against a query-string-free
// URL, sidesteps that rather than depending on exactly how the allow-list
// matcher treats it.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <ResetPasswordForm />
    </main>
  );
}
