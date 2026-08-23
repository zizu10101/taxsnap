import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InvoicesBody } from "@/components/invoices/invoices-body";

export const metadata: Metadata = {
  title: "Invoices — TaxSnap",
};

export default async function InvoicesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", user.id)
    .single();

  const isPro = profile?.subscription_status === "pro";

  const { data: invoices } = isPro
    ? await supabase
        .from("invoices")
        .select("*")
        .order("created_at", { ascending: false })
    : { data: null };

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
        <h1 className="text-2xl font-bold">Invoices</h1>
        <p className="text-muted-foreground">Bill your clients directly from TaxSnap.</p>
      </div>

      {isPro ? (
        <InvoicesBody initialInvoices={invoices ?? []} />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-medium">Invoicing is a Pro feature</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Upgrade to the Pro plan ($29/mo) to create and send client
              invoices right from TaxSnap.
            </p>
            <Button nativeButton={false} render={<Link href="/billing" />}>
              Upgrade to Pro
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
