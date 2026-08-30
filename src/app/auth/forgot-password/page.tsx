import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password — TaxSnap",
};

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <ForgotPasswordForm />
    </main>
  );
}
