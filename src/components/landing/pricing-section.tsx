import Link from "next/link";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FREE_PLAN, PRICING_PLANS } from "@/lib/pricing-plans";
import type { BillingTier } from "@/lib/stripe";

// Shared between / and /salons (and any future vertical landing page) -
// still reads name/price/features straight from pricing-plans.ts, the
// single source of truth also used by the authenticated /billing page, so
// a page-specific framing here can never let the actual numbers drift out
// of sync between pages (see that file's own comment for why that
// mattered enough to call out once already).
export function PricingSection({
  tiers,
  highlightTier,
  badgeLabel = "Most Popular",
  freeDescription,
  tierDescriptions,
  freeTagline,
  tierTaglines,
  freeFeatures,
  tierFeatures,
  extraAuthParams,
}: {
  // Which paid tiers to show, in order - lets a page drop Basic (e.g.
  // /salons, where it isn't relevant) without forking PRICING_PLANS
  // itself. Defaults to all of them (the homepage's current set).
  tiers?: BillingTier[];
  // Which card (if any) gets the accent border + badge treatment - the
  // homepage highlights Basic (its actual target tier); a page with
  // Basic excluded gets to make its own call instead of inheriting that.
  highlightTier?: BillingTier;
  badgeLabel?: string;
  // Overrides for the short one-liner under the plan name (normally
  // FREE_PLAN.description / plan.description from pricing-plans.ts) -
  // lets a vertical page (e.g. /salons) pitch a tier in its own words
  // without forking the shared name/price data those still come from.
  freeDescription?: string;
  tierDescriptions?: Partial<Record<BillingTier, string>>;
  // Optional one-line addendum under the price, same slot the homepage
  // already uses for Pro's "See true profit per job" line - lets each
  // page add its own framing without touching the shared feature list.
  freeTagline?: string;
  tierTaglines?: Partial<Record<BillingTier, string>>;
  // Full overrides for the feature bullet list - a vertical page's
  // feature set can differ enough from the generic PRICING_PLANS copy
  // (e.g. /salons' Free tier is "1 service, 1 stylist", not a receipt-
  // scan-count pitch) that a tagline addendum alone isn't enough. Falls
  // back to FREE_PLAN.features / plan.features when omitted, so the
  // homepage's default rendering is untouched.
  freeFeatures?: string[];
  tierFeatures?: Partial<Record<BillingTier, string[]>>;
  // Extra query params every "Get started" link on this section should
  // carry - e.g. /salons passes { business: "salon" } so signup defaults
  // to the right business type without the visitor picking it manually.
  extraAuthParams?: Record<string, string>;
}) {
  const plans = tiers ? PRICING_PLANS.filter((p) => tiers.includes(p.tier)) : PRICING_PLANS;
  const gridColsClass = plans.length <= 1 ? "sm:grid-cols-2" : "sm:grid-cols-3";

  function authHref(tier?: BillingTier) {
    const params = new URLSearchParams(extraAuthParams);
    if (tier) params.set("plan", tier);
    const qs = params.toString();
    return qs ? `/auth?${qs}` : "/auth";
  }

  return (
    <section id="pricing" className="border-t border-border">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-8">
        <h2 className="font-heading text-2xl font-bold">Pricing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Start free. Upgrade whenever you need more.
        </p>
        <div className={`mt-6 grid gap-4 ${gridColsClass}`}>
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
            <h3 className="font-heading text-lg font-bold">{FREE_PLAN.name}</h3>
            <p className="text-sm text-muted-foreground">
              {freeDescription ?? FREE_PLAN.description}
            </p>
            <p className="text-3xl font-bold">{FREE_PLAN.price}</p>
            {freeTagline && (
              <p className="-mt-1 text-xs font-medium text-primary">{freeTagline}</p>
            )}
            <ul className="space-y-2 text-sm text-muted-foreground">
              {(freeFeatures ?? FREE_PLAN.features).map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  {f}
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              className="mt-auto"
              nativeButton={false}
              render={<Link href={authHref()} />}
            >
              Get started free
            </Button>
          </div>
          {plans.map((plan) => {
            const isHighlighted = plan.tier === highlightTier;
            return (
              <div
                key={plan.tier}
                className={`relative flex flex-col gap-3 rounded-lg border bg-card p-5 ${
                  isHighlighted ? "border-primary shadow-sm" : "border-border"
                }`}
              >
                {isHighlighted && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 border-transparent bg-primary text-primary-foreground">
                    {badgeLabel}
                  </Badge>
                )}
                <h3 className="font-heading text-lg font-bold">{plan.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {tierDescriptions?.[plan.tier] ?? plan.description}
                </p>
                <p className="text-3xl font-bold">{plan.price}</p>
                {tierTaglines?.[plan.tier] && (
                  <p className="-mt-1 text-xs font-medium text-primary">
                    {tierTaglines[plan.tier]}
                  </p>
                )}
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {(
                    tierFeatures?.[plan.tier] ??
                    plan.features.filter((f) => {
                      // "Everything in Basic" only makes sense next to a
                      // visible Basic card - a page that excludes it (e.g.
                      // /salons) shouldn't reference a tier it never shows.
                      // Only applies to the default (unoverridden) feature
                      // list - an explicit tierFeatures override is
                      // author-controlled and never auto-filtered.
                      const referencedTier = f.match(/^Everything in (\w+)/)?.[1];
                      return (
                        !referencedTier ||
                        plans.some((p) => p.name === referencedTier) ||
                        tiers === undefined
                      );
                    })
                  ).map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-auto"
                  nativeButton={false}
                  render={<Link href={authHref(plan.tier)} />}
                >
                  Get started
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
