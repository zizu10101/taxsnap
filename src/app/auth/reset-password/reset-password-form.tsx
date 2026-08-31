"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
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

// Reached only via the emailed reset link: /auth/callback already exchanged
// the recovery code for a session and persisted it via Set-Cookie (same
// Route Handler magic-link/OAuth/signup-confirm use, redirected here
// afterward via the post_auth_redirect cookie - see
// ForgotPasswordForm/lib/auth-redirect.ts) before the browser ever got
// here, so this page just needs a plain supabase.auth.updateUser({
// password }) against the session already sitting in cookies - no
// separate token/code handling of its own. If that session is missing (an
// expired/already-used link, or the page reached directly), updateUser's
// own error surfaces as-is rather than a bespoke pre-check, same as the
// rest of this app's auth error handling.
export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }

    // Already signed in under the recovery session updateUser just changed
    // the password on - straight to the dashboard, same as a normal
    // password sign-in success (see AuthForm's handlePassword).
    const redirectTo = "/dashboard";
    window.location.assign(redirectTo);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <Link href="/" className="mx-auto mb-2 flex h-12 w-12 items-center justify-center">
          <img src="/logo-mark.png" alt="TaxSnap" className="h-12 w-12" />
        </Link>
        <CardTitle className="text-2xl">Set a new password</CardTitle>
        <CardDescription>Choose a new password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              placeholder="••••••••"
              required
              minLength={6}
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            Update password
          </Button>
          {error && (
            <p className="rounded-md bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
