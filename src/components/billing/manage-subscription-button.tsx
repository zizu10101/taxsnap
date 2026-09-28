"use client";

import { useState } from "react";
import { Loader2, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Shared between /billing's own Manage Subscription button, /dashboard/
// settings, and pricing-cards.tsx's redirect-to-portal fallback for an
// already-subscribed user clicking a different plan/interval card - one
// POST to /api/stripe/portal, one redirect, so none of those callers can
// drift into different behavior or wording for what's really one action.
// Redirects on success and never resolves (the browser navigates away);
// returns only on failure, leaving the toast to the caller since each one
// already manages its own loading state differently.
export async function openBillingPortal(): Promise<{ error: string } | void> {
  try {
    const res = await fetch("/api/stripe/portal", { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.url) {
      throw new Error(data.error || "Failed to open billing portal");
    }
    window.location.assign(data.url);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export function ManageSubscriptionButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    const result = await openBillingPortal();
    if (result) {
      toast.error(result.error);
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" className={className} onClick={handleClick} disabled={loading}>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Settings className="h-4 w-4" />
      )}
      Manage Subscription
    </Button>
  );
}
