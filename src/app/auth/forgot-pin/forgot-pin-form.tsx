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

// Deliberately reuses Supabase's password-recovery email as a pure
// identity-verification channel, not to touch the account password at all
// - it's the one credential a staff member sharing this device's browser
// session doesn't have (they'd need the owner's actual email inbox), which
// is exactly the bar a PIN reset needs to clear. See ResetAppPinForm for
// what happens once the emailed link lands: it never calls
// updateUser({password}), only /api/app-lock/set-owner-pin. Same
// account-existence-not-leaked pattern as ForgotPasswordForm.
export function ForgotPinForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    setPostAuthRedirect("/auth/reset-app-pin");
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
        <CardTitle className="text-2xl">Reset your Manager PIN</CardTitle>
        <CardDescription>
          Enter your account email and we&apos;ll send you a secure link to
          verify it&apos;s you, then you can set a new PIN.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <p className="rounded-md bg-success/10 p-3 text-center text-sm text-success">
            If an account exists for this email, a verification link has
            been sent.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-pin-email">Email</Label>
              <Input
                id="forgot-pin-email"
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
              Send verification link
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
