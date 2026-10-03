"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { ClientPdfButton } from "@/components/client-portal/client-pdf-button";
import { RANGE_PRESET_LABELS, getPresetRange, type DateRange, type RangePreset } from "@/lib/date-range";
import { formatDocumentNumber } from "@/lib/document-number";
import {
  filterPortalRows,
  summarizePortalBalance,
  summarizePortalRange,
  type PortalDocumentRow,
} from "@/lib/client-portal";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function formatDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function rangeLabel(preset: RangePreset, range: DateRange): string {
  if (preset === "all-time" || (!range.start && !range.end)) return "All time";
  const start = range.start ? formatDate(range.start) : "…";
  const end = range.end ? formatDate(range.end) : "…";
  return `${RANGE_PRESET_LABELS[preset]}: ${start} – ${end}`;
}

function StatusBadge({ row }: { row: PortalDocumentRow }) {
  if (row.type === "estimate") return <Badge variant="outline">Estimate</Badge>;
  if (row.status === "paid") return <Badge className="bg-success text-success-foreground">Paid</Badge>;
  if (row.status === "partial") return <Badge variant="secondary">Partially paid</Badge>;
  return <Badge variant="secondary">Unpaid</Badge>;
}

export function ClientDocumentsView({
  clientName,
  businessName,
  contact,
  documents,
}: {
  clientName: string;
  businessName: string | null;
  // From the owner's business profile; either may be empty.
  contact: { email: string; phone: string | null };
  documents: PortalDocumentRow[];
}) {
  const router = useRouter();
  const [preset, setPreset] = useState<RangePreset>("all-time");
  const [range, setRange] = useState<DateRange>(() => getPresetRange("all-time"));

  // Whole-account balance: never narrowed by the date filter.
  const balance = useMemo(() => summarizePortalBalance(documents), [documents]);
  const visible = useMemo(() => filterPortalRows(documents, range), [documents, range]);
  const summary = useMemo(() => summarizePortalRange(visible), [visible]);

  async function signOut() {
    await fetch("/api/client-portal/logout", { method: "POST" }).catch(() => {});
    router.replace("/client/documents");
    router.refresh();
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {businessName ?? "Your contractor"}
          </p>
          <h1 className="truncate text-2xl font-bold">{clientName}</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </header>

      <Card>
        <CardContent className="space-y-2 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Outstanding Balance
          </p>
          <p className="text-3xl font-semibold tabular-nums">{formatCurrency(balance.outstanding)}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span>
              Invoiced{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatCurrency(balance.invoiced)}
              </span>
            </span>
            <span>
              Paid{" "}
              <span className="font-medium text-success tabular-nums">
                {formatCurrency(balance.paid)}
              </span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Reflects invoices issued to you only. Estimates are not counted.
          </p>
        </CardContent>
      </Card>

      <section className="space-y-3" aria-label="Documents">
        <DateRangeFilter
          preset={preset}
          range={range}
          onChange={(nextPreset, nextRange) => {
            setPreset(nextPreset);
            setRange(nextRange);
          }}
        />

        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            {rangeLabel(preset, range)} · {summary.count} document{summary.count === 1 ? "" : "s"}
          </span>
          {summary.invoiceCount > 0 && (
            <span>
              Invoiced in this period{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatCurrency(summary.invoicedInRange)}
              </span>
            </span>
          )}
        </div>

        {visible.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <FileText className="h-8 w-8" />
              <p className="text-sm">
                {documents.length === 0
                  ? "Nothing has been sent to you yet."
                  : "No documents in this period."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {visible.map((row) => (
              <Card key={row.id}>
                <CardContent className="space-y-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">
                        {row.type === "invoice" ? "Invoice" : "Estimate"}{" "}
                        <span className="font-mono text-primary">
                          {formatDocumentNumber(row.type, row.document_number)}
                        </span>
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDate(row.issue_date)}</span>
                        <StatusBadge row={row} />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums">{formatCurrency(row.total_amount)}</p>
                      {row.type === "invoice" && row.balance > 0 && (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {formatCurrency(row.balance)} due
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/client/documents/${row.id}`} />}
                    >
                      View
                    </Button>
                    <ClientPdfButton
                      documentId={row.id}
                      type={row.type}
                      documentNumber={row.document_number}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {(contact.email || contact.phone) && (
        <footer className="border-t pt-4 text-sm text-muted-foreground">
          <p>
            Questions? Contact{" "}
            <span className="font-medium text-foreground">{businessName ?? "your contractor"}</span>
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="break-all text-primary underline-offset-4 hover:underline"
              >
                {contact.email}
              </a>
            )}
            {contact.phone && (
              <a
                href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                {contact.phone}
              </a>
            )}
          </p>
        </footer>
      )}
    </main>
  );
}
