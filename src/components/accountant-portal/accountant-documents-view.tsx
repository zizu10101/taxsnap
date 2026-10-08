"use client";

import { documentLabel } from "@/lib/document-label";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { formatCurrency, formatDate } from "@/components/accountant-portal/format";
import { getPresetRange, filterByRange, type DateRange, type RangePreset } from "@/lib/date-range";
import { formatDocumentNumber } from "@/lib/document-number";
import type { AccountantDocumentRow } from "@/lib/accountant-portal-server";

const TYPE_ITEMS = { all: "Invoices & estimates", invoice: "Invoices", estimate: "Estimates" };

function StatusBadge({ row }: { row: AccountantDocumentRow }) {
  if (row.status === "draft") return <Badge variant="outline">Draft</Badge>;
  if (row.status === "paid") return <Badge className="bg-success text-success-foreground">Paid</Badge>;
  if (row.status === "partial") return <Badge variant="secondary">Partial</Badge>;
  return <Badge variant="secondary">Sent</Badge>;
}

// Every invoice and estimate, read-only. Drafts are included and marked, since
// "full list" was the brief; an accountant can tell them apart by the badge.
export function AccountantDocumentsView({ documents }: { documents: AccountantDocumentRow[] }) {
  const [preset, setPreset] = useState<RangePreset>("this-year");
  const [range, setRange] = useState<DateRange>(() => getPresetRange("this-year"));
  const [type, setType] = useState<keyof typeof TYPE_ITEMS>("all");

  const visible = useMemo(
    () =>
      filterByRange(documents, range, "issue_date").filter((d) => type === "all" || d.type === type),
    [documents, range, type],
  );

  const totals = useMemo(() => {
    let invoiced = 0;
    let paid = 0;
    let hst = 0;
    for (const d of visible) {
      // Drafts and estimates are listed but are not revenue yet.
      if (d.type !== "invoice" || d.status === "draft") continue;
      invoiced += d.total_amount;
      paid += d.paid;
      hst += d.hst_amount;
    }
    return { invoiced, paid, hst };
  }, [visible]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <DateRangeFilter
          preset={preset}
          range={range}
          onChange={(nextPreset, nextRange) => {
            setPreset(nextPreset);
            setRange(nextRange);
          }}
        />
        <Select
          items={TYPE_ITEMS}
          value={type}
          onValueChange={(v) => setType((v as keyof typeof TYPE_ITEMS) ?? "all")}
        >
          <SelectTrigger className="w-full lg:w-56" aria-label="Document type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TYPE_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span>
          {visible.length} document{visible.length === 1 ? "" : "s"}
        </span>
        <span>
          Issued invoices{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatCurrency(totals.invoiced)}
          </span>
          {" · "}HST{" "}
          <span className="font-medium text-foreground tabular-nums">{formatCurrency(totals.hst)}</span>
          {" · "}Paid{" "}
          <span className="font-medium text-success tabular-nums">{formatCurrency(totals.paid)}</span>
        </span>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No documents match these filters.
            </p>
          ) : (
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">HST</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link
                        href={`/accountant/invoices/${d.id}`}
                        className="font-mono font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {formatDocumentNumber(d.type, d.document_number)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(d.issue_date)}</td>
                    <td className="px-3 py-2">{documentLabel(d.client_name, d.job_name, "—")}</td>
                    <td className="px-3 py-2">
                      <StatusBadge row={d} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(d.hst_amount)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatCurrency(d.total_amount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {d.type === "invoice" ? formatCurrency(d.paid) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
