import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { ProductList } from "@/components/commission/product-list";

export const metadata: Metadata = {
  title: "Products — TaxSnap",
};

// Same no-Pro-gate shape as services/page.tsx - a free-tier salon account
// gets a capped preview (1 active product) rather than being locked out
// entirely. The cap itself is enforced server-side (POST /api/products,
// PATCH /api/products/[id] - see lib/plan-limits.ts).
export default async function ProductsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, business_type, logo_url")
    .eq("id", user.id)
    .single();

  const { data: products } = await supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        back={<BackToDashboardLink />}
        title="Products"
        subtitle="Manage the products you sell alongside services at the Register."
      />

      <ProductList
        initialProducts={products ?? []}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        isPro={profile?.subscription_status === "pro"}
      />
    </div>
  );
}
