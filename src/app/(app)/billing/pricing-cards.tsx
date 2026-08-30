"use client";

import { useState } from "react";
import { Check, FileText, Loader2, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BillingTier } from "@/lib/stripe";
import type { SubscriptionStatus } from "@/lib/database.types";
import { PRICING_PLANS } from "@/lib/pricing-plans";

export function PricingCards({
  currentStatus,
  hasBillingAccount,
}: {
  currentStatus: SubscriptionStatus;
  hasBillingAccount: boolean;
}) {
  const [loadingTier, setLoadingTier] = useState<BillingTier | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  async function handleCheckout(tier: BillingTier) {
    setLoadingTier(tier);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Failed to start checkout");
      }
      window.location.assign(data.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setLoadingTier(null);
    }
  }

  async function handlePortal() {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Failed to open billing portal");
      }
      window.location.assign(data.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setPortalLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {hasBillingAccount && (
        <Button
          variant="outline"
          className="w-full"
          onClick={handlePortal}
          disabled={portalLoading}
        >
          {portalLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Settings className="h-4 w-4" />
          )}
          Manage billing
        </Button>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {PRICING_PLANS.map((plan) => {
          const isCurrent = currentStatus === plan.tier;
          return (
            <Card
              key={plan.tier}
              className={isCurrent ? "border-primary shadow-sm" : undefined}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    {plan.tier === "pro" && (
                      <FileText className="h-4 w-4 text-primary" />
                    )}
                    {plan.name}
                  </CardTitle>
                  {isCurrent && <Badge>Current plan</Badge>}
                </div>
                <CardDescription>{plan.description}</CardDescription>
                <p className="pt-2 text-3xl font-bold">{plan.price}</p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={isCurrent ? "outline" : "default"}
                  disabled={isCurrent || loadingTier !== null}
                  onClick={() => handleCheckout(plan.tier)}
                >
                  {loadingTier === plan.tier && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {isCurrent ? "Current plan" : `Upgrade to ${plan.name}`}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
