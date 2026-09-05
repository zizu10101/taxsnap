import type { Metadata } from "next";
import { ResetAppPinForm } from "./reset-app-pin-form";

export const metadata: Metadata = {
  title: "Set a new Manager PIN — TaxSnap",
};

// No code-exchange logic here - /auth/callback already exchanged the
// verification code for a session and persisted it via Set-Cookie before
// redirecting here (see ForgotPinForm), same pattern as
// /auth/reset-password.
export default function ResetAppPinPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <ResetAppPinForm />
    </main>
  );
}
