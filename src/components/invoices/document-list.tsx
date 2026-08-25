"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, CheckCircle2, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentBuilder } from "@/components/invoices/document-builder";
import { BusinessProfileCard } from "@/components/invoices/business-profile-card";
import { InvoiceBillingSummary } from "@/components/invoices/invoice-billing-summary";
import type { BusinessProfileFields } from "@/components/invoices/business-profile-dialog";
import type {
  Client,
  DocumentStatus,
  DocumentType,
  DocumentWithClient,
} from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_VARIANT: Record<DocumentStatus, "outline" | "secondary" | "default"> = {
  draft: "outline",
  sent: "secondary",
  partial: "secondary",
  paid: "default",
};

export function DocumentList({
  type,
  basePath,
  initialDocuments,
  initialClients,
  initialProfile,
  convertedMap = {},
  autoOpenNew = false,
}: {
  type: DocumentType;
  basePath: string;
  initialDocuments: DocumentWithClient[];
  initialClients: Client[];
  initialProfile: BusinessProfileFields;
  /** estimate id -> id of the invoice it was converted into (estimates only) */
  convertedMap?: Record<string, string>;
  autoOpenNew?: boolean;
}) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [clients, setClients] = useState(initialClients);
  const [converted, setConverted] = useState(convertedMap);
  const [builderOpen, setBuilderOpen] = useState(autoOpenNew);

  const label = type === "invoice" ? "Invoice" : "Estimate";

  async function handleConvert(id: string) {
    try {
      const res = await fetch(`/api/documents/${id}/convert`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (data.invoice_id) {
          setConverted((prev) => ({ ...prev, [id]: data.invoice_id }));
        }
        throw new Error(data.error || "Failed to convert");
      }
      setConverted((prev) => ({ ...prev, [id]: data.document.id }));
      toast.success("Converted to a draft invoice");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" render={<Link href="/dashboard/invoices" />}>
          Invoices
        </Button>
        <Button variant="outline" size="sm" render={<Link href="/dashboard/estimates" />}>
          Estimates
        </Button>
      </div>

      <BusinessProfileCard initialProfile={initialProfile} />

      {type === "invoice" && <InvoiceBillingSummary documents={documents} />}

      <Button className="w-full" onClick={() => setBuilderOpen(true)}>
        <Plus className="h-4 w-4" />
        New {label}
      </Button>

      {documents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <FileText className="h-8 w-8" />
            <p className="text-sm">No {label.toLowerCase()}s yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => {
            const convertedToId = type === "estimate" ? converted[doc.id] : undefined;
            return (
              <Card
                key={doc.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`${basePath}/${doc.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`${basePath}/${doc.id}`);
                  }
                }}
                className="cursor-pointer outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
              >
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">
                        {doc.client?.name ?? "No client"}
                      </p>
                      {convertedToId ? (
                        <Badge className="border-transparent bg-success text-success-foreground">
                          Converted
                        </Badge>
                      ) : (
                        <Badge variant={STATUS_VARIANT[doc.status]}>{doc.status}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(doc.issue_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <span className="block font-semibold tabular-nums">
                        {formatCurrency(doc.total_amount)}
                      </span>
                      {doc.status === "partial" && (
                        <span className="block text-[11px] text-muted-foreground tabular-nums">
                          {formatCurrency(
                            doc.total_amount -
                              doc.payments.reduce((sum, p) => sum + p.amount, 0),
                          )}{" "}
                          due
                        </span>
                      )}
                    </div>
                    {type === "estimate" &&
                      (convertedToId ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-success"
                          title="View invoice"
                          nativeButton={false}
                          render={<Link href={`/dashboard/invoices/${convertedToId}`} />}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Convert to invoice"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleConvert(doc.id);
                          }}
                        >
                          <ArrowRightLeft className="h-4 w-4" />
                        </Button>
                      ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <DocumentBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        defaultType={type}
        clients={clients}
        onSaved={(doc) => setDocuments((prev) => [doc, ...prev])}
        onClientCreated={(client) => setClients((prev) => [...prev, client])}
      />
    </div>
  );
}
