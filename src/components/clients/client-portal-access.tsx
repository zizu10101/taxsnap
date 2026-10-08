"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PinSetupFlow } from "@/components/ui/pin-setup-flow";
import { useRouter } from "next/navigation";

// The browser origin, so the shown link is the full URL. "" on the server so
// SSR and the first client paint agree (same useSyncExternalStore pattern as
// the install-prompt cards).
const noSubscription = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

type Confirming = "regenerate" | "remove" | null;

export function ClientPortalAccess({
  clientId,
  clientName,
  initialLinkToken,
  isPro,
}: {
  clientId: string;
  clientName: string;
  initialLinkToken: string | null;
  isPro: boolean;
}) {
  const router = useRouter();
  const origin = useSyncExternalStore(noSubscription, getOrigin, getServerOrigin);
  const [linkToken, setLinkToken] = useState(initialLinkToken);
  const [pinMode, setPinMode] = useState<"create" | "reset" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [copied, setCopied] = useState(false);
  // Bumped after a failed submit to remount the PIN flow blank.
  const [flowKey, setFlowKey] = useState(0);

  const endpoint = `/api/clients/${clientId}/portal`;
  const link = linkToken ? `${origin}/client-login/${linkToken}` : null;

  async function request(method: string, body?: unknown) {
    const res = await fetch(endpoint, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
    return data;
  }

  async function handlePin(pin: string) {
    if (!pinMode) return;
    setSubmitting(true);
    try {
      if (pinMode === "create") {
        const data = await request("POST", { pin });
        setLinkToken(data.link_token);
        toast.success("Portal login created. Copy the link and send it to your client.");
        router.refresh();
      } else {
        await request("PATCH", { action: "reset_pin", pin });
        toast.success("PIN reset. Your client was signed out everywhere.");
        router.refresh();
      }
      setPinMode(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the PIN.");
      setFlowKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  }

  async function handleRegenerate() {
    setBusy(true);
    try {
      const data = await request("PATCH", { action: "regenerate_link" });
      setLinkToken(data.link_token);
      setConfirming(null);
      toast.success("New link created. The old link no longer works.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create a new link.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await request("DELETE");
      setLinkToken(null);
      setConfirming(null);
      toast.success("Portal login removed.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove the login.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Portal access</CardTitle>
        {isPro &&
          (linkToken ? (
            <Badge variant="secondary">
              <KeyRound />
              Login active
            </Badge>
          ) : (
            <Badge variant="outline">No login</Badge>
          ))}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Gives {clientName} a read-only view of their own estimates and invoices, with PDF
          downloads. They sign in with their own link and a 4-digit PIN.
        </p>

        {!isPro ? (
          <p className="text-xs text-muted-foreground">
            The client portal is a Pro feature.{" "}
            <Link href="/billing" className="font-medium text-primary underline-offset-4 hover:underline">
              Upgrade to Pro
            </Link>
          </p>
        ) : !linkToken ? (
          <Button size="sm" onClick={() => setPinMode("create")}>
            Create portal login
          </Button>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Client&apos;s link
              </p>
              <p className="break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
                {link ?? `/client-login/${linkToken}`}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPinMode("reset")}>
                Reset PIN
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setConfirming("regenerate")}
              >
                New link
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                className="text-destructive"
                onClick={() => setConfirming("remove")}
              >
                Remove login
              </Button>
            </div>

            {confirming && (
              <div
                role="alert"
                className="space-y-2 rounded-md border border-destructive/40 p-3 text-xs"
              >
                <p>
                  {confirming === "regenerate"
                    ? "The old link stops working and your client is signed out everywhere. Their PIN stays the same."
                    : "Your client loses access and is signed out everywhere. You can create a new login later."}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={confirming === "regenerate" ? handleRegenerate : handleRemove}
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {confirming === "regenerate" ? "Create new link" : "Remove login"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={pinMode !== null} onOpenChange={(open) => !open && setPinMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pinMode === "reset" ? "Reset PIN" : "Create portal login"} for {clientName}
            </DialogTitle>
            <DialogDescription>
              A 4-digit PIN they&apos;ll use with their own link to view their documents. You
              won&apos;t be able to see it again, so tell them the PIN when you send the link.
            </DialogDescription>
          </DialogHeader>
          {pinMode && (
            <PinSetupFlow
              key={`${pinMode}-${flowKey}`}
              onSubmit={handlePin}
              submitting={submitting}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
