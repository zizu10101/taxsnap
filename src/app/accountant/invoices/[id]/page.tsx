import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PublicDocumentPaper } from "@/components/public/document-paper";
import { ClientPdfButton } from "@/components/client-portal/client-pdf-button";
import { formatCurrency, formatDate } from "@/components/accountant-portal/format";
import { getAccountantPageContext } from "@/lib/accountant-page";
import { getAccountantDocument, loadAccountantBusiness } from "@/lib/accountant-portal-server";

export const metadata: Metadata = {
  title: "Document — Accountant access — TaxSnap",
};

// One invoice or estimate, read-only: the shared PublicDocumentPaper (the same
// renderer as the public invoice link and the client portal), the payments
// logged against it, and a PDF download. A draft is shown with a Draft badge.
export default async function AccountantDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAccountantPageContext();
  if (!ctx.available) return null;

  const detail = await getAccountantDocument(ctx.db, id);
  if (!detail) notFound();

  const { business, logoPath } = await loadAccountantBusiness(ctx.admin, ctx.userId);
  let logoUrl: string | null = null;
  if (logoPath) {
    const { data } = await ctx.admin.storage.from("logos").createSignedUrl(logoPath, 60 * 60);
    logoUrl = data?.signedUrl ?? null;
  }
  const { document: doc, payments, paid } = detail;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 lg:max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/accountant/invoices" />}
        >
          <ArrowLeft className="h-4 w-4" />
          All documents
        </Button>
        <div className="flex items-center gap-2">
          {doc.status === "draft" && <Badge variant="outline">Draft</Badge>}
          {doc.excluded_from_hst && <Badge variant="secondary">Excluded from HST</Badge>}
          <ClientPdfButton
            apiBase="/api/accountant-portal/documents"
            documentId={doc.id}
            type={doc.type}
            documentNumber={doc.document_number}
            size="sm"
            variant="default"
          />
        </div>
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
        placeOfWork={doc.place_of_work}
        notes={doc.notes}
        jobName={doc.job?.name ?? null}
        logoUrl={logoUrl}
      />

      {doc.type === "invoice" && (
        <Card>
          <CardContent className="space-y-3 py-4 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Payments
            </p>
            {payments.length === 0 ? (
              <p className="text-muted-foreground">No payments recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">Received</th>
                      <th className="px-2 py-1.5 font-medium">Method</th>
                      <th className="px-2 py-1.5 font-medium">Deposited to</th>
                      <th className="py-1.5 pl-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-b last:border-0 align-top">
                        <td className="whitespace-nowrap py-1.5 pr-2">{formatDate(p.paid_date)}</td>
                        <td className="px-2 py-1.5">{p.method ?? "—"}</td>
                        <td className="px-2 py-1.5">{p.deposited_to ?? "—"}</td>
                        <td className="py-1.5 pl-2 text-right tabular-nums">
                          {formatCurrency(p.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-muted-foreground">Paid to date</span>
              <span className="font-medium tabular-nums">{formatCurrency(paid)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Balance due</span>
              <span className="font-medium tabular-nums">
                {formatCurrency(Math.max(doc.total_amount - paid, 0))}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
