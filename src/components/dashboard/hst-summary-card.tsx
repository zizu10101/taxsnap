"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Info,
  Landmark,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { calculateHSTReturn, type PaidInvoiceInput } from "@/lib/hst";
import {
  describeRange,
  filterByRange,
  getPresetRange,
  type DateRange,
  type RangePreset,
} from "@/lib/date-range";
import type {
  DocumentWithRelations,
  Receipt,
  SalesPeriod,
} from "@/lib/database.types";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function LineRow({
  line,
  label,
  value,
}: {
  line: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Badge
          variant="outline"
          className="shrink-0 border-success/30 bg-success/10 text-success"
        >
          Line {line}
        </Badge>
        <span className="truncate text-muted-foreground">{label}</span>
      </div>
      <span className="shrink-0 tabular-nums font-medium">
        {formatCurrency(value)}
      </span>
    </div>
  );
}

// Keyed by rangeLabel from the parent so the Gross Sales / Cash Deposits
// inputs reset to that period's saved values (or 0) whenever the dashboard's
// active date range changes, instead of carrying over the previous period's
// numbers.
function HstSummaryCardBody({
  rangeLabel,
  receipts,
  paidInvoices,
  saved,
  onSaved,
}: {
  rangeLabel: string;
  receipts: Receipt[];
  paidInvoices: PaidInvoiceInput[];
  saved: SalesPeriod | undefined;
  onSaved: (record: SalesPeriod) => void;
}) {
  const [grossSales, setGrossSales] = useState(saved?.gross_sales ?? 0);
  const [cashDeposits, setCashDeposits] = useState(saved?.cash_deposits ?? 0);
  const [saving, setSaving] = useState(false);

  const lines = useMemo(
    () => calculateHSTReturn(grossSales, paidInvoices, receipts),
    [grossSales, paidInvoices, receipts],
  );

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period_label: rangeLabel,
          gross_sales: grossSales,
          cash_deposits: cashDeposits,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      onSaved(data.sales as SalesPeriod);
      toast.success(`Saved sales figures for ${rangeLabel}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const isRefund = lines.line109 < 0;

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-1.5 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Planning estimate only, not tax advice. Verify these figures and the
        current CRA line numbers with your bookkeeper or accountant before
        filing.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="gross-sales">Gross Sales ($)</Label>
          <Input
            id="gross-sales"
            type="number"
            step="0.01"
            value={grossSales}
            onChange={(e) => setGrossSales(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cash-deposits">Cash Deposits ($)</Label>
          <Input
            id="cash-deposits"
            type="number"
            step="0.01"
            value={cashDeposits}
            onChange={(e) => setCashDeposits(parseFloat(e.target.value) || 0)}
          />
          <p className="text-[11px] text-muted-foreground">
            For your own reconciliation - not included in Line 101.
          </p>
        </div>
      </div>

      <Button size="sm" variant="outline" onClick={handleSave} disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        Save for {rangeLabel}
      </Button>

      <div className="space-y-2">
        <LineRow line="101" label="Total Sales & Revenue" value={lines.line101} />
        {paidInvoices.length > 0 && (
          <p className="pl-1 text-[11px] text-muted-foreground">
            Includes {formatCurrency(
              paidInvoices.reduce((sum, i) => sum + i.subtotal, 0),
            )}{" "}
            from {paidInvoices.length} paid{" "}
            {paidInvoices.length === 1 ? "invoice" : "invoices"}.
          </p>
        )}
        <LineRow
          line="103"
          label="GST/HST Collected (13%)"
          value={lines.line103}
        />
        <LineRow
          line="106"
          label="Input Tax Credits (ITCs)"
          value={lines.line106}
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between rounded-lg bg-success/10 p-4">
        <div className="flex items-center gap-2">
          <Badge className="border-transparent bg-success text-success-foreground">
            Line 109
          </Badge>
          <span className="font-semibold">
            {isRefund ? "Refund" : "Net Tax Payable"}
          </span>
        </div>
        <span className="text-xl font-bold tabular-nums text-success">
          {formatCurrency(Math.abs(lines.line109))}
        </span>
      </div>
    </div>
  );
}

// The HST card's period is independent of the main receipts date-range
// filter above it - a contractor might be browsing "This Month" of
// receipts while checking HST numbers for a whole quarter, so it gets its
// own picker (defaulting to "This Quarter", since GST/HST is commonly
// filed quarterly) using the same DateRangeFilter component.
export function HstSummaryCard({ receipts }: { receipts: Receipt[] }) {
  const [collapsed, setCollapsed] = useState(true);
  const [salesRecords, setSalesRecords] = useState<SalesPeriod[]>([]);
  const [paidInvoiceDocs, setPaidInvoiceDocs] = useState<DocumentWithRelations[]>(
    [],
  );
  const [preset, setPreset] = useState<RangePreset>("this-quarter");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-quarter"));

  useEffect(() => {
    fetch("/api/sales")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.sales)) setSalesRecords(data.sales);
      })
      .catch(() => {
        // Non-fatal: the calculator still works with figures entered this session.
      });

    // Non-Pro users get a 403 here (invoicing is a Pro feature) - that's
    // fine, the calculator just runs with $0 invoiced revenue in that case.
    fetch("/api/documents?type=invoice")
      .then((res) => (res.ok ? res.json() : { documents: [] }))
      .then((data) => {
        if (Array.isArray(data.documents)) {
          setPaidInvoiceDocs(
            data.documents.filter(
              (d: DocumentWithRelations) => d.status === "paid",
            ),
          );
        }
      })
      .catch(() => {
        // Non-fatal: same as above.
      });
  }, []);

  const filteredReceipts = useMemo(
    () => filterByRange(receipts, range),
    [receipts, range],
  );
  const filteredPaidInvoices = useMemo(
    () =>
      paidInvoiceDocs
        .filter((d) => {
          if (range.start && d.issue_date < range.start) return false;
          if (range.end && d.issue_date > range.end) return false;
          return true;
        })
        .map((d) => ({ subtotal: d.subtotal, hst_amount: d.hst_amount })),
    [paidInvoiceDocs, range],
  );
  const rangeLabel = useMemo(() => describeRange(preset, range), [preset, range]);

  function handleRangeChange(nextPreset: RangePreset, nextRange: DateRange) {
    setPreset(nextPreset);
    setRange(nextRange);
  }

  const saved = salesRecords.find((s) => s.period_label === rangeLabel);

  function handleSaved(record: SalesPeriod) {
    setSalesRecords((prev) => [
      record,
      ...prev.filter((s) => s.id !== record.id),
    ]);
  }

  return (
    <Card className="font-sans">
      <CardHeader
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed((prev) => !prev);
          }
        }}
        className="flex cursor-pointer flex-row items-center justify-between outline-none"
      >
        <div>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-success" />
            Ontario HST Return Helper
          </CardTitle>
          <CardDescription>{rangeLabel}</CardDescription>
        </div>
        {collapsed ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        )}
      </CardHeader>
      {!collapsed && (
        <CardContent className="space-y-4">
          <DateRangeFilter preset={preset} range={range} onChange={handleRangeChange} />
          <HstSummaryCardBody
            key={rangeLabel}
            rangeLabel={rangeLabel}
            receipts={filteredReceipts}
            paidInvoices={filteredPaidInvoices}
            saved={saved}
            onSaved={handleSaved}
          />
        </CardContent>
      )}
    </Card>
  );
}
