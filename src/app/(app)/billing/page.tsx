import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PricingCards } from "./pricing-cards";
import { PlanCapsTable } from "@/components/billing/plan-caps-table";
import { RenewalStatus } from "@/components/billing/renewal-status";
import { BILLING_CHANGE_POLICY } from "@/lib/pricing-plans";

export const metadata: Metadata = {
  title: "Billing — TaxSnap",
};

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "subscription_status, stripe_customer_id, billing_interval, current_period_end, cancel_at_period_end, pending_tier, pending_change_effective_at",
    )
    .eq("id", user.id)
    .single();

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground">
          Choose the plan that fits your business.
        </p>
        <p className="text-xs text-muted-foreground">{BILLING_CHANGE_POLICY}</p>
        <RenewalStatus
          billingInterval={profile?.billing_interval ?? null}
          currentPeriodEnd={profile?.current_period_end ?? null}
          cancelAtPeriodEnd={profile?.cancel_at_period_end ?? false}
          pendingTier={profile?.pending_tier ?? null}
          pendingChangeEffectiveAt={profile?.pending_change_effective_at ?? null}
        />
      </div>

      <PricingCards
        currentStatus={profile?.subscription_status ?? "free"}
        currentInterval={profile?.billing_interval ?? null}
        hasBillingAccount={!!profile?.stripe_customer_id}
      />

      <div className="mt-8 space-y-2">
        <h2 className="font-heading text-lg font-bold">Plan caps</h2>
        <p className="text-sm text-muted-foreground">
          Every plan includes every feature - this is what changes per plan.
        </p>
        <PlanCapsTable currentTier={profile?.subscription_status ?? "free"} />
      </div>
    </div>
  );
}
