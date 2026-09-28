"use client";

import { useState } from "react";
import { Check, FileText, Loader2 } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ManageSubscriptionButton, openBillingPortal } from "@/components/billing/manage-subscription-button";
import type { BillingInterval, BillingTier } from "@/lib/stripe";
import type { SubscriptionStatus } from "@/lib/database.types";
import { PRICING_PLANS, formatCadPrice, formatPerMonthEquivalent } from "@/lib/pricing-plans";

export function PricingCards({
  currentStatus,
  currentInterval,
  hasBillingAccount,
}: {
  currentStatus: SubscriptionStatus;
  // Only meaningful once currentStatus isn't "free" - null for a free
  // account or if a webhook hasn't populated it yet for an existing
  // subscriber (see profiles.billing_interval).
  currentInterval: BillingInterval | null;
  hasBillingAccount: boolean;
}) {
  const [loadingTier, setLoadingTier] = useState<BillingTier | null>(null);
  // Defaults to the account's own current interval when it has one, so an
  // existing subscriber sees their real plan marked "Current plan"
  // immediately instead of having to toggle to find it.
  const [billingInterval, setBillingInterval] = useState<BillingInterval>(
    currentInterval ?? "monthly",
  );
  const hasActiveSubscription = currentStatus !== "free";

  async function handleCheckout(tier: BillingTier) {
    setLoadingTier(tier);

    // Re-running Checkout for an account that already has a subscription
    // doesn't upgrade/switch it - Stripe creates a second, independent
    // subscription instead, double-billing the customer. An existing
    // subscriber changing tier or interval has to go through the Customer
    // Portal instead (see openBillingPortal), which handles the correct
    // timing itself - immediate + invoiced now for an upgrade, deferred to
    // period end via a Subscription Schedule for a downgrade (Plus<->Pro
    // included) - see BILLING_CHANGE_POLICY in pricing-plans.ts for the
    // user-facing wording and CLAUDE.md for how this was verified against
    // real portal sessions, not assumed.
    if (hasActiveSubscription) {
      const result = await openBillingPortal();
      if (result) {
        toast.error(result.error);
        setLoadingTier(null);
      }
      return;
    }

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, interval: billingInterval }),
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

  return (
    <div className="space-y-4">
      {hasBillingAccount && <ManageSubscriptionButton className="w-full" />}

      <Tabs
        value={billingInterval}
        onValueChange={(v) => setBillingInterval(v as BillingInterval)}
      >
        <TabsList>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="yearly">
            Annual
            <Badge className="ml-1.5 border-transparent bg-success/15 text-success">
              2 months free
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid items-stretch gap-4 sm:grid-cols-2">
        {PRICING_PLANS.map((plan) => {
          const isCurrent =
            currentStatus === plan.tier && currentInterval === billingInterval;
          const price =
            billingInterval === "monthly" ? plan.monthlyPrice : plan.yearlyPrice;
          return (
            <Card
              key={plan.tier}
              className={`h-full ${isCurrent ? "border-primary shadow-sm" : ""}`}
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
                <p className="pt-2 text-3xl font-bold">
                  {formatCadPrice(price, billingInterval)}
                </p>
                {billingInterval === "yearly" && (
                  <p className="-mt-2 text-xs text-muted-foreground">
                    {formatPerMonthEquivalent(plan.yearlyPrice)} billed annually
                  </p>
                )}
              </CardHeader>
              {/* flex-1 so this absorbs whatever height the two cards'
                  differing feature-list lengths don't share, pinning both
                  footers (and their buttons) to the same bottom edge
                  regardless of how many lines either plan has. */}
              <CardContent className="flex-1">
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
                  {isCurrent
                    ? "Current plan"
                    : hasActiveSubscription
                      ? `Switch to ${plan.name}`
                      : `Upgrade to ${plan.name}`}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
