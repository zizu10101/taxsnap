import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { PublicDocumentPaper } from "@/components/public/document-paper";

export const metadata: Metadata = {
  title: "Invoice — TaxSnap",
};

// Public, unauthenticated, read-only page - the link the client's
// "invoice is ready" email points at (see lib/email.ts). Same
// token-only authorization boundary as /sign/[token]: knowing view_token
// is knowing the invoice, resolved via the admin client since there's no
// session to satisfy RLS with.
export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: invoice } = await supabase
    .from("documents")
    .select("*, items:document_items(*), client:clients(*)")
    .eq("view_token", token)
    .eq("type", "invoice")
    .maybeSingle();

  if (!invoice) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name, business_email, business_phone, business_address, logo_url")
    .eq("id", invoice.user_id)
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
      <PublicDocumentPaper
        type="invoice"
        documentNumber={invoice.document_number}
        issueDate={invoice.issue_date}
        dueDate={invoice.due_date}
        items={invoice.items ?? []}
        subtotal={invoice.subtotal}
        hstAmount={invoice.hst_amount}
        totalAmount={invoice.total_amount}
        business={business}
        client={invoice.client}
        logoUrl={logoUrl}
      />
    </div>
  );
}
