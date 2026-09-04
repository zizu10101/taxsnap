"use client";

import { useState } from "react";
import { Loader2, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Shared between /billing and /dashboard/settings - same POST to
// /api/stripe/portal, same redirect - so the two entry points can't drift
// into different behavior or wording for what's really one action.
export function ManageSubscriptionButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Failed to open billing portal");
      }
      window.location.assign(data.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
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
