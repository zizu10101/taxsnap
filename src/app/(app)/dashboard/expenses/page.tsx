import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { PageHeader } from "@/components/dashboard/page-header";
import { ExpensesBody } from "@/components/dashboard/expenses-body";

export const metadata: Metadata = {
  title: "Expenses — TaxSnap",
};

// General-business only, same precedent as dashboard/overview/page.tsx -
// a salon account hitting this URL directly redirects to /dashboard
// rather than rendering. Salon accounts already see their own receipts
// mixed into the main dashboard page and don't get an Expenses nav item
// (see nav-config.ts).
export default async function ExpensesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "subscription_status, business_type, logo_url, business_name, business_email, business_phone, business_address",
    )
    .eq("id", user.id)
    .single();

  if (profile?.business_type === "salon") {
    redirect("/dashboard");
  }

  const [{ data: receipts }, { data: jobs }, { data: templates }] = await Promise.all([
    supabase
      .from("receipts")
      .select("*")
      .order("transaction_date", { ascending: false }),
    supabase.from("jobs").select("name").order("name", { ascending: true }),
    supabase
      .from("expense_templates")
      .select("*, job:jobs(name)")
      .order("name", { ascending: true }),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        back={<BackToDashboardLink />}
        title="Expenses"
        subtitle="Every scanned receipt, filtered by date range."
      />

      <ExpensesBody
        initialReceipts={receipts ?? []}
        initialJobNames={(jobs ?? []).map((j) => j.name)}
        initialTemplates={templates ?? []}
        business={{
          name: profile?.business_name ?? null,
          email: profile?.business_email || user.email || "",
          phone: profile?.business_phone ?? null,
          address: profile?.business_address ?? null,
        }}
        logoPath={profile?.logo_url ?? null}
      />
    </div>
  );
}
