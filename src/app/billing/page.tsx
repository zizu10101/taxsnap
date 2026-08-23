import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PricingCards } from "./pricing-cards";

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
    .select("subscription_status, stripe_customer_id")
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
      </div>

      <PricingCards
        currentStatus={profile?.subscription_status ?? "free"}
        hasBillingAccount={!!profile?.stripe_customer_id}
      />
    </div>
  );
}
