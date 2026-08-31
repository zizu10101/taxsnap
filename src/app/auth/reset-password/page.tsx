import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Set a new password — TaxSnap",
};

// No code-exchange logic here anymore - /auth/callback (a real Route
// Handler) already exchanged the recovery code for a session and
// persisted it via Set-Cookie before redirecting here (see
// ForgotPasswordForm and lib/auth-redirect.ts). This used to do its own
// exchangeCodeForSession() call inline in this Server Component, which
// looked like it worked (the exchange itself succeeded) but could never
// actually persist the resulting session - Next.js only allows setting
// cookies on the response from a Route Handler, Server Action, or
// middleware, never a plain Server Component render, so the session was
// silently dropped and updateUser() on submit always failed with
// "Auth session missing!".
export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <ResetPasswordForm />
    </main>
  );
}
