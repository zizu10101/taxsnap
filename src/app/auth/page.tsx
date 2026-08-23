import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthForm } from "./auth-form";

export const metadata: Metadata = {
  title: "Sign in — TaxSnap",
};

export default function AuthPage() {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <Suspense>
        <AuthForm />
      </Suspense>
    </main>
  );
}
