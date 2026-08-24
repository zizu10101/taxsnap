"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentBuilder } from "@/components/invoices/document-builder";
import { BusinessLogoUpload } from "@/components/invoices/business-logo";
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
  paid: "default",
};

export function DocumentList({
  type,
  basePath,
  initialDocuments,
  initialClients,
  initialLogoPath,
}: {
  type: DocumentType;
  basePath: string;
  initialDocuments: DocumentWithClient[];
  initialClients: Client[];
  initialLogoPath: string | null;
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [clients, setClients] = useState(initialClients);
  const [logoPath, setLogoPath] = useState(initialLogoPath);
  const [builderOpen, setBuilderOpen] = useState(false);

  const label = type === "invoice" ? "Invoice" : "Estimate";

  async function handleConvert(id: string) {
    try {
      const res = await fetch(`/api/documents/${id}/convert`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to convert");
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

      <BusinessLogoUpload logoPath={logoPath} onLogoChange={setLogoPath} />

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
          {documents.map((doc) => (
            <Card key={doc.id}>
              <Link href={`${basePath}/${doc.id}`} className="block">
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">
                        {doc.client?.name ?? "No client"}
                      </p>
                      <Badge variant={STATUS_VARIANT[doc.status]}>{doc.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(doc.issue_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums">
                      {formatCurrency(doc.total_amount)}
                    </span>
                    {type === "estimate" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Convert to invoice"
                        onClick={(e) => {
                          e.preventDefault();
                          handleConvert(doc.id);
                        }}
                      >
                        <ArrowRightLeft className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Link>
            </Card>
          ))}
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
