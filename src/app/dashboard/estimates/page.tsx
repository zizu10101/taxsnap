import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentList } from "@/components/invoices/document-list";

export const metadata: Metadata = {
  title: "Estimates — TaxSnap",
};

export default async function EstimatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, logo_url")
    .eq("id", user.id)
    .single();

  const isPro = profile?.subscription_status === "pro";

  const [{ data: documents }, { data: clients }] = isPro
    ? await Promise.all([
        supabase
          .from("documents")
          .select("*, client:clients(*)")
          .eq("type", "estimate")
          .order("issue_date", { ascending: false }),
        supabase.from("clients").select("*").order("name", { ascending: true }),
      ])
    : [{ data: null }, { data: null }];

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
        <h1 className="text-2xl font-bold">Estimates</h1>
        <p className="text-muted-foreground">
          Quote a job, then convert it to an invoice once it&apos;s approved.
        </p>
      </div>

      {isPro ? (
        <DocumentList
          type="estimate"
          basePath="/dashboard/estimates"
          initialDocuments={documents ?? []}
          initialClients={clients ?? []}
          initialLogoPath={profile?.logo_url ?? null}
        />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="font-medium">Estimates are a Pro feature</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Upgrade to the Pro plan ($29/mo) to create invoices and
              estimates, manage clients, and track payment status.
            </p>
            <Button render={<Link href="/billing" />}>Upgrade to Pro</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
