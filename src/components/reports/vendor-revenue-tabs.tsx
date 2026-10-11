"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { getPresetRange, type DateRange, type RangePreset } from "@/lib/date-range";
import { downloadCsv, revenueReportToCsv, vendorReportToCsv } from "@/lib/csv";
import type { VendorReport } from "@/lib/vendor-report";
import type { RevenueGroup, RevenueReport } from "@/lib/revenue-report";

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

function formatMonth(month: string) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatPercent(fraction: number) {
  return `${(fraction * 100).toFixed(1)}%`;
}

function rangeQuery(range: DateRange): URLSearchParams {
  const params = new URLSearchParams();
  if (range.start) params.set("from", range.start);
  if (range.end) params.set("to", range.end);
  return params;
}

function fileRange(range: DateRange): string {
  return `${range.start ?? "start"}-to-${range.end ?? "now"}`;
}

// One report's range + data. setLoading(true) lives in the change handlers, not
// in the effect body (react-hooks/set-state-in-effect); the mount fetch always
// runs so a stale router cache can't show old numbers.
function useReport<T>(url: string, errorMessage: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: T) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(errorMessage);
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url, errorMessage]);

  return { data, loading, setLoading };
}

function Spinner() {
  return (
    <div className="flex h-40 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return open ? (
    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
  ) : (
    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
  );
}

// ---------------------------------------------------------------- vendors

export function VendorsTab({
  apiBase,
  expenseBase,
}: {
  apiBase: string;
  // Where one expense opens (`${expenseBase}${id}`); null when the viewer has no such page.
  expenseBase: string | null;
}) {
  const [preset, setPreset] = useState<RangePreset>("this-month");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-month"));
  const [category, setCategory] = useState<string>("all");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const params = rangeQuery(range);
  if (category !== "all") params.set("category", category);
  const { data, loading, setLoading } = useReport<VendorReport>(
    `${apiBase}/vendors?${params}`,
    "Failed to load expenses by vendor",
  );

  const items = useMemo(() => {
    const map: Record<string, string> = { all: "All categories" };
    for (const c of data?.categories ?? []) map[c] = c;
    // A picked category can have no spend in a newly chosen range; keep it selectable.
    if (category !== "all") map[category] = category;
    return map;
  }, [data?.categories, category]);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <DateRangeFilter
        preset={preset}
        range={range}
        onChange={(p, r) => {
          setLoading(true);
          setPreset(p);
          setRange(r);
        }}
      />
      {loading && !data ? (
        <Spinner />
      ) : (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Expenses by Vendor</CardTitle>
              <Button
                variant="outline"
                size="sm"
                disabled={!data || data.vendors.length === 0}
                onClick={() => data && downloadCsv(`taxsnap-expenses-by-vendor-${fileRange(range)}.csv`, vendorReportToCsv(data))}
              >
                <Download className="mr-1.5 h-4 w-4" />
                Export CSV
              </Button>
            </div>
            <div className="max-w-xs">
              <Select
                items={items}
                value={category}
                onValueChange={(v) => {
                  setLoading(true);
                  setCategory(v || "all");
                }}
              >
                <SelectTrigger aria-label="Category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {Object.keys(items)
                    .filter((k) => k !== "all")
                    .map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className={loading ? "opacity-60" : undefined}>
            {!data || data.vendors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expenses in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[38rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Vendor</th>
                      <th className="px-2 py-2 text-right font-medium">Expenses</th>
                      <th className="px-2 py-2 text-right font-medium">Subtotal</th>
                      <th className="px-2 py-2 text-right font-medium">Tax (HST)</th>
                      <th className="px-2 py-2 text-right font-medium">Total</th>
                      <th className="py-2 pl-2 text-right font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.vendors.map((v) => {
                      const isOpen = open.has(v.key);
                      return (
                        <Fragment key={v.key}>
                          <tr className="border-b last:border-0">
                            <td className="py-2 pr-3 font-medium">
                              <button
                                type="button"
                                onClick={() => toggle(v.key)}
                                aria-expanded={isOpen}
                                className="flex items-center gap-1.5 text-left hover:text-primary"
                              >
                                <Chevron open={isOpen} />
                                {v.name}
                              </button>
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">{v.count}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(v.subtotal)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(v.tax)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(v.total)}</td>
                            <td className="py-2 pl-2 text-right tabular-nums">{formatPercent(v.share)}</td>
                          </tr>
                          {isOpen && (
                            <tr className="border-b last:border-0">
                              <td colSpan={6} className="bg-muted/20 p-2">
                                <table className="w-full min-w-[30rem] text-xs">
                                  <thead>
                                    <tr className="border-b text-left text-muted-foreground">
                                      <th className="py-1.5 pr-2 font-medium">Date</th>
                                      <th className="px-2 py-1.5 font-medium">Merchant</th>
                                      <th className="px-2 py-1.5 font-medium">Category</th>
                                      <th className="px-2 py-1.5 text-right font-medium">Tax</th>
                                      <th className="py-1.5 pl-2 text-right font-medium">Paid</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {v.expenses.map((e) => (
                                      <tr key={e.id} className="border-b last:border-0">
                                        <td className="py-1.5 pr-2">{formatDate(e.date)}</td>
                                        <td className="px-2 py-1.5">
                                          {expenseBase ? (
                                            <Link
                                              href={`${expenseBase}${e.id}`}
                                              className="underline underline-offset-2"
                                            >
                                              {e.merchant}
                                            </Link>
                                          ) : (
                                            e.merchant
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5">{e.category}</td>
                                        <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(e.tax)}</td>
                                        <td className="py-1.5 pl-2 text-right tabular-nums">{formatCurrency(e.total)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-semibold">
                      <td className="py-2 pr-3">Total</td>
                      <td className="px-2 py-2 text-right tabular-nums">{data.totals.count}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(data.totals.subtotal)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(data.totals.tax)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(data.totals.total)}</td>
                      <td className="py-2 pl-2 text-right tabular-nums">
                        {data.totals.total === 0 ? "0.0%" : "100.0%"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <p className="pt-2 text-xs text-muted-foreground">
                  Receipts and card-statement expenses are grouped by vendor, so &quot;HOME DEPOT
                  #4521&quot; and &quot;Home Depot&quot; are one row. Amounts are as paid, HST
                  included; the total equals Expenses on the P&amp;L for the same range
                  {category !== "all" ? ` (filtered to ${category})` : ""}.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- revenue

function SummaryFigure({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-lg bg-primary/10 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{formatCurrency(value)}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function GroupTable({
  title,
  groups,
  documentBase,
}: {
  title: string;
  groups: RevenueGroup[];
  documentBase: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const keyOf = (g: RevenueGroup) => g.id ?? "none";
  const totals = groups.reduce(
    (a, g) => ({
      invoices: a.invoices + g.invoices,
      invoiced: a.invoiced + g.invoiced,
      received: a.received + g.received,
      outstanding: a.outstanding + g.outstanding,
    }),
    { invoices: 0, invoiced: 0, received: 0, outstanding: 0 },
  );

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing in this range.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">{title}</th>
            <th className="px-2 py-2 text-right font-medium">Invoices</th>
            <th className="px-2 py-2 text-right font-medium">Invoiced</th>
            <th className="px-2 py-2 text-right font-medium">Received</th>
            <th className="py-2 pl-2 text-right font-medium">Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const key = keyOf(g);
            const isOpen = open.has(key);
            return (
              <Fragment key={key}>
                <tr className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-expanded={isOpen}
                      className="flex items-center gap-1.5 text-left hover:text-primary"
                    >
                      <Chevron open={isOpen} />
                      <span className={g.id === null ? "italic" : undefined}>{g.name}</span>
                    </button>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{g.invoices}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(g.invoiced)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(g.received)}</td>
                  <td className="py-2 pl-2 text-right tabular-nums">{formatCurrency(g.outstanding)}</td>
                </tr>
                {isOpen && (
                  <tr className="border-b last:border-0">
                    <td colSpan={5} className="space-y-3 bg-muted/20 p-2 text-xs">
                      <div>
                        <p className="pb-1 font-medium">Payments received</p>
                        {g.payments.length === 0 ? (
                          <p className="text-muted-foreground">No payments in this range.</p>
                        ) : (
                          <table className="w-full min-w-[26rem]">
                            <tbody>
                              {g.payments.map((p) => (
                                <tr key={p.paymentId} className="border-b last:border-0">
                                  <td className="py-1.5 pr-2">{formatDate(p.paidDate)}</td>
                                  <td className="px-2 py-1.5">
                                    <Link
                                      href={`${documentBase}/${p.documentId}`}
                                      className="underline underline-offset-2"
                                    >
                                      #{p.documentNumber}
                                    </Link>
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(p.amount)}</td>
                                  <td className="py-1.5 pl-2 text-right tabular-nums">
                                    {formatCurrency(p.revenue)} before HST
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                      <div>
                        <p className="pb-1 font-medium">Invoices issued</p>
                        {g.documents.length === 0 ? (
                          <p className="text-muted-foreground">None issued in this range.</p>
                        ) : (
                          <table className="w-full min-w-[26rem]">
                            <tbody>
                              {g.documents.map((d) => (
                                <tr key={d.id} className="border-b last:border-0">
                                  <td className="py-1.5 pr-2">{formatDate(d.issueDate)}</td>
                                  <td className="px-2 py-1.5">
                                    <Link
                                      href={`${documentBase}/${d.id}`}
                                      className="underline underline-offset-2"
                                    >
                                      #{d.number}
                                    </Link>
                                  </td>
                                  <td className="px-2 py-1.5 capitalize text-muted-foreground">{d.status}</td>
                                  <td className="py-1.5 pl-2 text-right tabular-nums">
                                    {formatCurrency(d.subtotal)} before HST
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <td className="py-2 pr-3">Total</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.invoices}</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(totals.invoiced)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(totals.received)}</td>
            <td className="py-2 pl-2 text-right tabular-nums">{formatCurrency(totals.outstanding)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function RevenueTab({
  apiBase,
  documentBase,
}: {
  apiBase: string;
  documentBase: string;
}) {
  const [preset, setPreset] = useState<RangePreset>("this-month");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-month"));
  const { data, loading, setLoading } = useReport<RevenueReport>(
    `${apiBase}/revenue?${rangeQuery(range)}`,
    "Failed to load the revenue report",
  );

  return (
    <div className="space-y-4">
      <DateRangeFilter
        preset={preset}
        range={range}
        onChange={(p, r) => {
          setLoading(true);
          setPreset(p);
          setRange(r);
        }}
      />
      {loading && !data ? (
        <Spinner />
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Couldn&apos;t load the revenue report.</p>
      ) : (
        <div className={loading ? "space-y-4 opacity-60" : "space-y-4"}>
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Revenue</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadCsv(`taxsnap-revenue-${fileRange(range)}.csv`, revenueReportToCsv(data))}
                >
                  <Download className="mr-1.5 h-4 w-4" />
                  Export CSV
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Revenue is payments received in the range, before HST, and leaves out invoices
                excluded from HST - the same figure as the P&amp;L and the HST helper. Invoiced is
                what was issued in the range (drafts left out). Outstanding is Invoiced minus
                Received, so payments on earlier invoices can make it smaller or negative.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryFigure label="Received" value={data.summary.received} hint="Payments in the range" />
                <SummaryFigure label="Invoiced" value={data.summary.invoiced} hint="Issued in the range" />
                <SummaryFigure label="Outstanding" value={data.summary.outstanding} hint="Invoiced minus received" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By Client</CardTitle>
            </CardHeader>
            <CardContent>
              <GroupTable title="Client" groups={data.byClient} documentBase={documentBase} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By Job</CardTitle>
            </CardHeader>
            <CardContent>
              <GroupTable title="Job" groups={data.byJob} documentBase={documentBase} />
            </CardContent>
          </Card>

          {data.byMonth.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By Month</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[24rem] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Month</th>
                        <th className="px-2 py-2 text-right font-medium">Invoiced</th>
                        <th className="px-2 py-2 text-right font-medium">Received</th>
                        <th className="py-2 pl-2 text-right font-medium">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byMonth.map((m) => (
                        <tr key={m.month} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-medium">{formatMonth(m.month)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(m.invoiced)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(m.received)}</td>
                          <td className="py-2 pl-2 text-right tabular-nums">{formatCurrency(m.outstanding)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-semibold">
                        <td className="py-2 pr-3">Total</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(data.summary.invoiced)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(data.summary.received)}</td>
                        <td className="py-2 pl-2 text-right tabular-nums">{formatCurrency(data.summary.outstanding)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
