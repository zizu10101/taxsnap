"use client";

import { useMemo, useState } from "react";
import { useSyncedState } from "@/lib/use-synced-state";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, CheckCircle2, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BusinessProfileCard } from "@/components/invoices/business-profile-card";
import { InvoiceBillingSummary } from "@/components/invoices/invoice-billing-summary";
import { DocumentWorkstation } from "@/components/invoices/document-workstation";
import { UsageLimitBar } from "@/components/dashboard/usage-limit-bar";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import { getPresetRange, rangeToUtcBounds } from "@/lib/date-range";
import type { BusinessProfileFields } from "@/components/invoices/business-profile-dialog";
import { invoiceDetailHref } from "@/lib/invoice-back";
import {
  countInvoicesThisMonth,
  drawBadgeLabel,
  filterByInvoiceType,
  type InvoiceTypeFilter,
} from "@/lib/document-filter";
import type {
  BusinessType,
  Client,
  DocumentStatus,
  DocumentType,
  DocumentWithRelations,
  SubscriptionStatus,
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
  businessType,
  subscriptionStatus,
  convertedMap = {},
}: {
  type: DocumentType;
  basePath: string;
  // Widened from DocumentWithClient to also carry line items - needed by
  // the lg+ DocumentWorkstation's live preview below (see that file).
  initialDocuments: DocumentWithRelations[];
  initialClients: Client[];
  initialProfile: BusinessProfileFields;
  // Hides the Estimates toggle below for salon accounts - Estimates
  // doesn't apply to that business type and is blocked at the route level
  // (dashboard/estimates/layout.tsx), so this page's own Invoices/Estimates
  // switcher shouldn't offer a link that only bounces back.
  businessType: BusinessType;
  // Drives both usage bars below - invoices per month (invoice view only;
  // estimates are unlimited at every tier) and total clients (both views,
  // since either can create one via "+ Add new client").
  subscriptionStatus: SubscriptionStatus;
  /** estimate id -> id of the invoice it was converted into (estimates only) */
  convertedMap?: Record<string, string>;
}) {
  const router = useRouter();
  // Never mutated locally anymore - creating now navigates to its own
  // page (see the "New {label}" button below) instead of appending to
  // this list in place, so this can just read the server-fetched value
  // directly rather than needing its own state.
  const documents = initialDocuments;
  const [converted, setConverted] = useSyncedState(convertedMap);
  const [typeFilter, setTypeFilter] = useState<InvoiceTypeFilter>("all");

  // Progress draws are invoices too and are listed with the rest; this only
  // narrows what is SHOWN. The usage bar and billing summary below keep using
  // the full list, so a filter can never change the invoice count.
  const hasDraws = type === "invoice" && documents.some((d) => d.is_progress_draw);
  const visibleDocuments = useMemo(
    () => (type === "invoice" ? filterByInvoiceType(documents, typeFilter) : documents),
    [documents, type, typeFilter],
  );
  // An invoice opens remembering it was opened from this list (its Back link).
  const detailHref = (id: string) =>
    type === "invoice" ? invoiceDetailHref(id, "invoices") : `${basePath}/${id}`;

  const label = type === "invoice" ? "Invoice" : "Estimate";

  // Same "this-month" window POST /api/documents' own cap check uses (see
  // src/lib/plan-limits.ts) - computed from the already-loaded list so
  // this stays in sync with optimistic updates (a just-created invoice)
  // without a second fetch.
  const invoicesThisMonth = useMemo(() => {
    if (type !== "invoice") return 0;
    const { from } = rangeToUtcBounds(getPresetRange("this-month"));
    return countInvoicesThisMonth(documents, from);
  }, [documents, type]);

  async function handleConvert(id: string) {
    try {
      const res = await fetch(`/api/documents/${id}/convert`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (data.invoice_id) {
          setConverted((prev) => ({ ...prev, [id]: data.invoice_id }));
        }
        // A converted estimate inserts as a real invoice row, so it's
        // capped by the same monthly invoice limit as creating one
        // directly (see src/lib/plan-limits.ts).
        if (data.code === "FREE_LIMIT_REACHED") {
          toast.error(data.error, {
            action: { label: "Upgrade", onClick: () => router.push("/billing") },
          });
          return;
        }
        throw new Error(data.error || "Failed to convert");
      }
      setConverted((prev) => ({ ...prev, [id]: data.document.id }));
      toast.success("Converted to a draft invoice");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="hover:bg-primary/10 hover:text-primary"
          nativeButton={false}
          render={<Link href="/dashboard/invoices" />}
        >
          Invoices
        </Button>
        {businessType !== "salon" && (
          <Button
            variant="outline"
            size="sm"
            className="hover:bg-primary/10 hover:text-primary"
            nativeButton={false}
            render={<Link href="/dashboard/estimates" />}
          >
            Estimates
          </Button>
        )}
      </div>

      <BusinessProfileCard initialProfile={initialProfile} />

      {type === "invoice" && <InvoiceBillingSummary documents={documents} />}

      {type === "invoice" && (
        <UsageLimitBar
          tier={subscriptionStatus}
          current={invoicesThisMonth}
          limit={PLAN_LIMITS[subscriptionStatus].invoicesPerMonth}
          noun="invoice"
          period="this month"
        />
      )}

      <UsageLimitBar
        tier={subscriptionStatus}
        current={initialClients.length}
        limit={PLAN_LIMITS[subscriptionStatus].clients}
        noun="client"
      />

      {/* Outside the lg:hidden mobile list below so the create button is
          reachable at every width - the lg+ DocumentWorkstation only
          replaces the list, not this. */}
      <Button
        className="w-full lg:w-auto"
        nativeButton={false}
        render={<Link href={`${basePath}/new`} />}
      >
        <Plus className="h-4 w-4" />
        New {label}
      </Button>

      {hasDraws && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Invoice type">
          <span className="text-xs text-muted-foreground">Type</span>
          {(
            [
              ["all", "All"],
              ["standard", "Standard"],
              ["progress", "Progress"],
            ] as const
          ).map(([value, text]) => (
            <Button
              key={value}
              size="sm"
              variant={typeFilter === value ? "default" : "outline"}
              aria-pressed={typeFilter === value}
              onClick={() => setTypeFilter(value)}
            >
              {text}
            </Button>
          ))}
        </div>
      )}

      <div className="space-y-4 lg:hidden">
      {visibleDocuments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <FileText className="h-8 w-8" />
            <p className="text-sm">
              {documents.length === 0
                ? `No ${label.toLowerCase()}s yet.`
                : `No ${typeFilter} ${label.toLowerCase()}s.`}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleDocuments.map((doc) => {
            const convertedToId = type === "estimate" ? converted[doc.id] : undefined;
            return (
              <Card
                key={doc.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(detailHref(doc.id))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(detailHref(doc.id));
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
                      {drawBadgeLabel(doc) && <Badge variant="outline">{drawBadgeLabel(doc)}</Badge>}
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
      </div>

      <div className="hidden lg:block">
        <DocumentWorkstation
          type={type}
          documents={visibleDocuments}
          business={{
            name: initialProfile.business_name,
            email: initialProfile.business_email ?? "",
            phone: initialProfile.business_phone,
            address: initialProfile.business_address,
          }}
          logoPath={initialProfile.logo_url}
          basePath={basePath}
          convertedMap={converted}
          onConvert={handleConvert}
        />
      </div>
    </div>
  );
}
