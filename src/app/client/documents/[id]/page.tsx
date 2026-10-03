import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  CLIENT_COOKIE,
  CLIENT_LINK_COOKIE,
  createServiceClient,
  lookupClientSession,
} from "@/lib/client-session";
import { loadPortalBusiness, loadPortalDocument } from "@/lib/client-portal-server";
import { PublicDocumentPaper } from "@/components/public/document-paper";
import { ClientPdfButton } from "@/components/client-portal/client-pdf-button";

export const metadata: Metadata = {
  title: "Document — TaxSnap",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

// Reuses the shared PublicDocumentPaper (the same renderer behind
// /invoice/[token] and /sign/[token]) - read-only by construction, so there
// is no second document renderer to keep in sync. A document that isn't this
// client's own, or is still a draft, is a plain 404.
export default async function ClientDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const cookieStore = await cookies();
  const raw = cookieStore.get(CLIENT_COOKIE)?.value;
  const session = raw ? await lookupClientSession(raw) : null;
  if (!session) {
    const linkToken = cookieStore.get(CLIENT_LINK_COOKIE)?.value;
    redirect(linkToken ? `/client-login/${linkToken}` : "/client/documents");
  }

  const supabase = createServiceClient();
  const detail = await loadPortalDocument(supabase, session, id);
  if (!detail) notFound();

  const { business, logoUrl } = await loadPortalBusiness(supabase, session);
  const { document: doc } = detail;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/client/documents" />}
        >
          <ArrowLeft className="h-4 w-4" />
          All documents
        </Button>
        <ClientPdfButton
          documentId={doc.id}
          type={doc.type}
          documentNumber={doc.document_number}
          size="sm"
          variant="default"
        />
      </div>

      <PublicDocumentPaper
        type={doc.type}
        documentNumber={doc.document_number}
        issueDate={doc.issue_date}
        dueDate={doc.due_date}
        items={doc.items}
        subtotal={doc.subtotal}
        hstAmount={doc.hst_amount}
        totalAmount={doc.total_amount}
        business={business}
        client={doc.client}
        logoUrl={logoUrl}
      />

      {doc.type === "invoice" && (
        <Card>
          <CardContent className="space-y-2 py-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Paid to date</span>
              <span className="font-medium text-success tabular-nums">
                {formatCurrency(detail.paid)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium">Outstanding Balance</span>
              <span className="text-lg font-semibold tabular-nums">
                {formatCurrency(detail.balance)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">This invoice only.</p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
