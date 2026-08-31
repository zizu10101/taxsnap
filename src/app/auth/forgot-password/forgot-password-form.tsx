"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { setPostAuthRedirect } from "@/lib/auth-redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Always shows the same confirmation regardless of whether the email is
// actually registered - supabase.auth.resetPasswordForEmail itself doesn't
// reveal that either (it resolves the same way whether or not an account
// exists), so this just doesn't undo that by branching the UI on the
// result. A thrown/rejected call (network failure, rate limiting) is the
// only thing that gets its own error message - neither case leaks account
// existence.
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Routes through /auth/callback like magic-link/OAuth/signup-confirm,
    // not directly at /auth/reset-password - the callback's Route Handler
    // can actually persist the session cookies exchangeCodeForSession
    // produces (Set-Cookie only works from a Route Handler, Server Action,
    // or middleware, never a plain Server Component page render), whereas
    // reset-password/page.tsx doing its own exchange inline previously
    // looked like it worked (the code exchange itself succeeded) but never
    // actually wrote the session to the browser, so updateUser() on submit
    // always failed with "Auth session missing!". See lib/auth-redirect.ts
    // for why the real destination travels via a cookie instead of a
    // redirectTo query string.
    setPostAuthRedirect("/auth/reset-password");
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <Link href="/" className="mx-auto mb-2 flex h-12 w-12 items-center justify-center">
          <img src="/logo-mark.png" alt="TaxSnap" className="h-12 w-12" />
        </Link>
        <CardTitle className="text-2xl">Reset your password</CardTitle>
        <CardDescription>
          Enter your account email and we&apos;ll send you a link to set a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <p className="rounded-md bg-success/10 p-3 text-center text-sm text-success">
            If an account exists for this email, a reset link has been sent.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              Send reset link
            </Button>
            {error && (
              <p className="rounded-md bg-destructive/10 p-3 text-center text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
        )}
        <Link
          href="/auth"
          className="mt-4 flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </CardContent>
    </Card>
  );
}
