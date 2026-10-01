"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Copy, KeyRound, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const subscribeNoop = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

// Settings only owns the one shared sign-in link. Everything per-employee
// (setting, resetting and removing PINs, seeing who is clocked in) lives on
// the Employees page - the single home for employees - so it isn't duplicated
// here.
export function EmployeeLoginSettings({ initialToken }: { initialToken: string | null }) {
  const origin = useSyncExternalStore(subscribeNoop, getOrigin, getServerOrigin);
  const [token, setToken] = useState(initialToken);
  const [linkBusy, setLinkBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const link = token ? `${origin}/employee-login/${token}` : "";

  async function requestLink(regenerate: boolean) {
    setLinkBusy(true);
    try {
      const res = await fetch("/api/employee-login-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't create the link.");
      setToken(data.token);
      setConfirmRegen(false);
      if (regenerate) toast.success("New link created. The old one no longer works.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLinkBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          Employee login
        </CardTitle>
        <CardDescription>
          Employees clock in and out of jobs with one shared link and their own 4-digit PIN. They
          can&apos;t see anything else in your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Shared sign-in link</Label>
          {token ? (
            <>
              <div className="flex gap-2">
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" size="icon" title="Copy link" onClick={copyLink}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this one link with everyone on your team. It keeps working until you
                regenerate it.
              </p>
              {confirmRegen ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-destructive">
                    The old link stops working and everyone is signed out.
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={linkBusy}
                    onClick={() => requestLink(true)}
                  >
                    {linkBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Yes, regenerate
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirmRegen(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(true)}>
                  Regenerate link
                </Button>
              )}
            </>
          ) : (
            <Button onClick={() => requestLink(false)} disabled={linkBusy}>
              {linkBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              Create sign-in link
            </Button>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          Set up and manage employee PINs from the{" "}
          <Link href="/dashboard/employees" className="font-medium text-foreground underline hover:text-primary">
            Employees page
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
