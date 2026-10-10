import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { PublicDocumentPaper } from "@/components/public/document-paper";
import { EstimateSignForm, SignedConfirmation } from "@/components/public/estimate-sign-form";

export const metadata: Metadata = {
  title: "Sign Estimate — TaxSnap",
};

// Public, unauthenticated page - no session exists here at all, so every
// lookup below uses the service-role admin client (bypasses RLS) and
// resolves *only* by the opaque sign_token in the URL, exactly like its
// sibling POST /api/sign/[token]. There is no other authorization check
// on this page: knowing the token is knowing the estimate.
export default async function SignEstimatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: estimate } = await supabase
    .from("documents")
    // Explicit columns, never "*": this page is public, and documents carries owner-only fields.
    .select("user_id, document_number, issue_date, due_date, subtotal, hst_amount, total_amount, place_of_work, notes, signed_at, items:document_items(*), client:clients(*), job:jobs(name)")
    .eq("sign_token", token)
    .eq("type", "estimate")
    .maybeSingle();

  if (!estimate) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name, business_email, business_phone, business_address, logo_url")
    .eq("id", estimate.user_id)
    .single();

  let logoUrl: string | null = null;
  if (profile?.logo_url) {
    const { data: signed } = await supabase.storage
      .from("logos")
      .createSignedUrl(profile.logo_url, 60 * 60);
    logoUrl = signed?.signedUrl ?? null;
  }

  const business = {
    name: profile?.business_name ?? null,
    email: profile?.business_email ?? "",
    phone: profile?.business_phone ?? null,
    address: profile?.business_address ?? null,
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 py-10">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          Please review and sign the estimate below.
        </p>
      </div>

      <PublicDocumentPaper
        type="estimate"
        documentNumber={estimate.document_number}
        issueDate={estimate.issue_date}
        dueDate={estimate.due_date}
        items={estimate.items ?? []}
        subtotal={estimate.subtotal}
        hstAmount={estimate.hst_amount}
        totalAmount={estimate.total_amount}
        business={business}
        client={estimate.client}
        placeOfWork={estimate.place_of_work}
        notes={estimate.notes}
        jobName={estimate.job?.name ?? null}
        logoUrl={logoUrl}
      />

      {estimate.signed_at ? (
        <SignedConfirmation signedAt={estimate.signed_at} />
      ) : (
        <EstimateSignForm token={token} />
      )}
    </div>
  );
}
