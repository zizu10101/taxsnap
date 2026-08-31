"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Mail } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Mode = "magic-link" | "password";
type PasswordAction = "sign-in" | "sign-up";

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 18 18" {...props}>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.27-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function AuthForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/dashboard";
  const urlError = searchParams.get("error");

  const [mode, setMode] = useState<Mode>("magic-link");
  const [passwordAction, setPasswordAction] =
    useState<PasswordAction>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(urlError);
  // The magic-link email also carries a 6-digit code (see the Supabase
  // email template) as a fallback for the click-the-link path - link
  // scanners in some recipients' mail security stacks (Safe Links,
  // Advanced Phishing Protection, etc.) can prefetch and consume the
  // single-use magic-link token before the real click ever happens,
  // which showed up as real "expired" failures in production. The code
  // has no URL for anything to prefetch, so it's immune to that. Once a
  // link is requested, this step shows in place of the email form until
  // a different email is chosen.
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verifyingCode, setVerifyingCode] = useState(false);

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);
    setMessage(null);

    setPostAuthRedirect(redirectTo);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    // On success the browser navigates away to Google's consent screen -
    // only an error leaves us still on this page needing to reset loading.
    if (error) {
      setLoading(false);
      setError(error.message);
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    setPostAuthRedirect(redirectTo);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setOtpSent(true);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setVerifyingCode(true);
    setCodeError(null);

    const supabase = createClient();
    // Doesn't go through /auth/callback at all - verifyOtp establishes the
    // session directly client-side, the same way signInWithPassword does
    // below, so there's no Supabase-domain round trip and no redirect_to
    // to worry about for this path.
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otpCode,
      type: "email",
    });

    setVerifyingCode(false);
    if (error) {
      setCodeError(error.message);
    } else {
      window.location.assign(redirectTo);
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();

    if (passwordAction === "sign-up") {
      setPostAuthRedirect(redirectTo);
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      setLoading(false);
      if (error) {
        setError(error.message);
      } else {
        setMessage("Account created! Check your email to confirm, then sign in.");
      }
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      window.location.assign(redirectTo);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <Link href="/" className="mx-auto mb-2 flex h-12 w-12 items-center justify-center">
          <img src="/logo-mark.png" alt="TaxSnap" className="h-12 w-12" />
        </Link>
        <CardTitle className="text-2xl">Welcome to TaxSnap</CardTitle>
        <CardDescription>
          Snap receipts, track write-offs, save on taxes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogleSignIn}
          disabled={loading}
        >
          <GoogleIcon className="h-4 w-4" />
          Continue with Google
        </Button>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="magic-link">Magic Link</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
          </TabsList>

          <TabsContent value="magic-link" className="mt-4">
            {otpSent ? (
              <div className="space-y-4">
                <p className="rounded-md bg-success/10 p-3 text-center text-sm text-success">
                  Check your email for a sign-in link, or enter the 6-digit code
                  from that email below.
                </p>
                <form onSubmit={handleVerifyCode} className="space-y-2">
                  <Label htmlFor="otp-code">6-digit code</Label>
                  <div className="flex gap-2">
                    <Input
                      id="otp-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      maxLength={6}
                      required
                      value={otpCode}
                      onChange={(e) =>
                        setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                    />
                    <Button type="submit" disabled={verifyingCode || otpCode.length !== 6}>
                      {verifyingCode && <Loader2 className="h-4 w-4 animate-spin" />}
                      Verify
                    </Button>
                  </div>
                  {codeError && <p className="text-sm text-destructive">{codeError}</p>}
                </form>
                <button
                  type="button"
                  className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setOtpSent(false);
                    setOtpCode("");
                    setCodeError(null);
                  }}
                >
                  Use a different email
                </button>
              </div>
            ) : (
              <form onSubmit={handleMagicLink} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="magic-email">Email</Label>
                  <Input
                    id="magic-email"
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
                  Send magic link
                </Button>
              </form>
            )}
          </TabsContent>

          <TabsContent value="password" className="mt-4">
            <form onSubmit={handlePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pw-email">Email</Label>
                <Input
                  id="pw-email"
                  type="email"
                  placeholder="you@example.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="pw-password">Password</Label>
                  {passwordAction === "sign-in" && (
                    <Link
                      href="/auth/forgot-password"
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Forgot password?
                    </Link>
                  )}
                </div>
                <Input
                  id="pw-password"
                  type="password"
                  placeholder="••••••••"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {passwordAction === "sign-in" ? "Sign in" : "Create account"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setPasswordAction((prev) =>
                    prev === "sign-in" ? "sign-up" : "sign-in",
                  )
                }
              >
                {passwordAction === "sign-in"
                  ? "Need an account? Sign up"
                  : "Already have an account? Sign in"}
              </button>
            </form>
          </TabsContent>
        </Tabs>

        {message && (
          <p className="mt-4 rounded-md bg-success/10 p-3 text-center text-sm text-success">
            {message}
          </p>
        )}
        {error && (
          <p className="mt-4 rounded-md bg-destructive/10 p-3 text-center text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
