"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Camera, Loader2, Mail } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Mode = "magic-link" | "password";
type PasswordAction = "sign-in" | "sign-up";

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

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setMessage("Check your email for a magic sign-in link.");
    }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();

    if (passwordAction === "sign-up") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`,
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
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Camera className="h-6 w-6" />
        </div>
        <CardTitle className="text-2xl">Welcome to TaxSnap</CardTitle>
        <CardDescription>
          Snap receipts, track write-offs, save on taxes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="magic-link">Magic Link</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
          </TabsList>

          <TabsContent value="magic-link" className="mt-4">
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
                <Label htmlFor="pw-password">Password</Label>
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
