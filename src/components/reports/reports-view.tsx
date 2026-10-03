"use client";

import { useEffect, useMemo, useState, createContext, useContext } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { getPresetRange, type DateRange, type RangePreset } from "@/lib/date-range";
import { NOT_SPECIFIED, type AccountSpendRow } from "@/lib/account-spending";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ExpenseDetailRow,
  JobSummaryData,
  JobSummaryRow,
  ReportsData,
  RevenueDetailRow,
} from "@/lib/reports-query";

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

// Money-positive in ledger green, a loss in destructive red, zero neutral -
// the design system's semantic tokens, not raw Tailwind colors.
function profitClass(value: number) {
  if (value > 0) return "text-success";
  if (value < 0) return "text-destructive";
  return "";
}

// Where the report's data and document links come from. The owner's Reports
// page uses the defaults; the read-only accountant portal passes its own
// (same view, same components - just a different API prefix and document page).
//
// Plain strings on purpose: the accountant page is a server component, and a
// function prop can't cross the server -> client boundary.
export interface ReportsEndpoints {
  apiBase: string;
  // Where an invoice opens from a drill-down row: `${documentBase}/${id}`.
  documentBase: string;
}

const OWNER_ENDPOINTS: ReportsEndpoints = {
  apiBase: "/api/reports",
  documentBase: "/dashboard/invoices",
};

const ReportsEndpointsContext = createContext<ReportsEndpoints>(OWNER_ENDPOINTS);

function rangeParams(range: DateRange) {
  const params = new URLSearchParams();
  // Plain inclusive "YYYY-MM-DD" bounds - see getReportsData.
  if (range.start) params.set("from", range.start);
  if (range.end) params.set("to", range.end);
  return params;
}

const EMPTY_DATA: ReportsData = {
  pnl: { revenue: 0, expenses: 0, netProfit: 0 },
  categories: [],
  accounts: { rows: [], total: 0 },
};

const EMPTY_JOBS: JobSummaryData = { jobs: [], unlinked: null };

type ReportTab = "pnl" | "jobs" | "categories" | "accounts";

const TABS: { key: ReportTab; label: string }[] = [
  { key: "pnl", label: "P&L" },
  { key: "jobs", label: "Job Summary" },
  { key: "categories", label: "Expenses by Category" },
  { key: "accounts", label: "By Account" },
];

// Fetches one drill-down's rows when its panel mounts. Callers key the panel
// by the range + target, so a range change remounts it and refetches - no
// state reset needed inside an effect (react-hooks/set-state-in-effect).
function useDetail<T>(url: string): { data: T | null; failed: boolean } {
  const [state, setState] = useState<{ data: T | null; failed: boolean }>({
    data: null,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: T) => {
        if (!cancelled) setState({ data: json, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ data: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}

function DetailShell({
  loading,
  failed,
  empty,
  children,
}: {
  loading: boolean;
  failed: boolean;
  empty: boolean;
  children: React.ReactNode;
}) {
  if (failed) return <p className="py-2 text-xs text-destructive">Couldn&apos;t load these rows.</p>;
  if (loading) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (empty) return <p className="py-2 text-xs text-muted-foreground">Nothing in this range.</p>;
  return <>{children}</>;
}

function RevenueDetail({ range }: { range: DateRange }) {
  const { apiBase, documentBase } = useContext(ReportsEndpointsContext);
  const { data, failed } = useDetail<{ rows: RevenueDetailRow[]; total: number }>(
    `${apiBase}/detail?${new URLSearchParams([["type", "revenue"], ...rangeParams(range)])}`,
  );

  return (
    <DetailShell loading={!data && !failed} failed={failed} empty={!!data && data.rows.length === 0}>
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Received</th>
                <th className="px-2 py-1.5 font-medium">Invoice</th>
                <th className="px-2 py-1.5 font-medium">Client</th>
                <th className="px-2 py-1.5 font-medium">Deposited to</th>
                <th className="px-2 py-1.5 text-right font-medium">Payment</th>
                <th className="py-1.5 pl-2 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.paymentId} className="border-b last:border-0">
                  <td className="py-1.5 pr-2">{formatDate(r.paidDate)}</td>
                  <td className="px-2 py-1.5">
                    <Link
                      href={`${documentBase}/${r.documentId}`}
                      className="underline underline-offset-2"
                    >
                      #{r.documentNumber}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">{r.clientName}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{r.depositedTo ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.amount)}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">{formatCurrency(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <td colSpan={5} className="py-1.5 pr-2">
                  Total revenue
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums">{formatCurrency(data.total)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="pt-1 text-[11px] text-muted-foreground">
            Revenue is the part of each payment before HST. Invoices excluded from HST aren&apos;t
            listed.
          </p>
        </div>
      )}
    </DetailShell>
  );
}

// The receipts behind a number: every expense in the range (no scope), one
// category's, or one account's (an account id, or "none" for expenses with no
// "Paid with"). The Paid with column is dropped when it would repeat the account.
function ExpenseDetail({
  range,
  category,
  account,
}: {
  range: DateRange;
  category?: string;
  account?: string;
}) {
  const scoped: [string, string][] =
    account !== undefined
      ? [
          ["type", "account"],
          ["account", account],
        ]
      : category !== undefined
        ? [
            ["type", "category"],
            ["category", category],
          ]
        : [["type", "expenses"]];
  const params = new URLSearchParams([...scoped, ...rangeParams(range)]);
  const showCategory = category === undefined;
  const showPaidWith = account === undefined;
  const { apiBase } = useContext(ReportsEndpointsContext);
  const { data, failed } = useDetail<{ rows: ExpenseDetailRow[]; total: number }>(
    `${apiBase}/detail?${params}`,
  );

  return (
    <DetailShell loading={!data && !failed} failed={failed} empty={!!data && data.rows.length === 0}>
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Date</th>
                <th className="px-2 py-1.5 font-medium">Merchant</th>
                {showCategory && <th className="px-2 py-1.5 font-medium">Category</th>}
                <th className="px-2 py-1.5 font-medium">Job</th>
                {showPaidWith && <th className="px-2 py-1.5 font-medium">Paid with</th>}
                <th className="py-1.5 pl-2 text-right font-medium">Paid</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-2">{formatDate(r.date)}</td>
                  <td className="px-2 py-1.5">{r.merchant}</td>
                  {showCategory && <td className="px-2 py-1.5">{r.category}</td>}
                  <td className="px-2 py-1.5 text-muted-foreground">{r.job ?? "—"}</td>
                  {showPaidWith && (
                    <td className="px-2 py-1.5 text-muted-foreground">{r.paidWith ?? "—"}</td>
                  )}
                  <td className="py-1.5 pl-2 text-right tabular-nums">{formatCurrency(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <td
                  colSpan={3 + (showCategory ? 1 : 0) + (showPaidWith ? 1 : 0)}
                  className="py-1.5 pr-2"
                >
                  Total
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums">{formatCurrency(data.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </DetailShell>
  );
}

// One P&L line: the label doubles as a toggle for its underlying transactions.
function ExpandableLine({
  label,
  value,
  open,
  onToggle,
  children,
}: {
  label: string;
  value: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-md py-1 text-left text-sm hover:bg-muted/50"
      >
        <span className="flex items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          {label}
        </span>
        <span className="font-medium tabular-nums">{formatCurrency(value)}</span>
      </button>
      {open && <div className="mb-2 mt-1 rounded-lg border bg-muted/20 p-2">{children}</div>}
    </div>
  );
}

function JobRows({ row, italic }: { row: JobSummaryRow; italic?: boolean }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3">
        <span className={italic ? "font-medium italic" : "font-medium"}>{row.name}</span>
        {row.jobId && (
          <span className="block text-xs text-muted-foreground">
            {row.invoiceCount} linked invoice{row.invoiceCount === 1 ? "" : "s"}
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(row.revenue)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(row.expenses)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(row.labor)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(row.totalCost)}</td>
      <td className={`py-2 pl-2 text-right font-semibold tabular-nums ${profitClass(row.profit)}`}>
        {formatCurrency(row.profit)}
      </td>
    </tr>
  );
}

// The route-level Pro gate happens one level up (dashboard/reports/page.tsx),
// same precedent as ExpenseOverview. The initial props only seed first paint -
// the mount fetches below always run, since Next's client router cache can
// serve a stale payload when arriving here right after recording a payment or
// expense.
export function ReportsView({
  initialData,
  initialJobs,
  endpoints = OWNER_ENDPOINTS,
}: {
  initialData: ReportsData;
  initialJobs: JobSummaryData;
  endpoints?: ReportsEndpoints;
}) {
  return (
    <ReportsEndpointsContext.Provider value={endpoints}>
      <ReportsViewInner initialData={initialData} initialJobs={initialJobs} />
    </ReportsEndpointsContext.Provider>
  );
}

function ReportsViewInner({
  initialData,
  initialJobs,
}: {
  initialData: ReportsData;
  initialJobs: JobSummaryData;
}) {
  const { apiBase } = useContext(ReportsEndpointsContext);
  const [tab, setTab] = useState<ReportTab>("pnl");

  // P&L and Expenses by Category share one range...
  const [preset, setPreset] = useState<RangePreset>("this-month");
  const [range, setRange] = useState<DateRange>(getPresetRange("this-month"));
  const [data, setData] = useState<ReportsData>(initialData);
  const [loading, setLoading] = useState(false);

  // ...the Job Summary has its own, defaulting to all time (what it showed
  // before it had a filter) so switching tabs never silently re-scopes it.
  const [jobsPreset, setJobsPreset] = useState<RangePreset>("all-time");
  const [jobsRange, setJobsRange] = useState<DateRange>(getPresetRange("all-time"));
  const [jobsData, setJobsData] = useState<JobSummaryData>(initialJobs);
  const [jobsLoading, setJobsLoading] = useState(false);

  const [revenueOpen, setRevenueOpen] = useState(false);
  const [expensesOpen, setExpensesOpen] = useState(false);
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());

  // setLoading(true) is in the change handlers (real event handlers), not in
  // these effects' synchronous bodies - react-hooks/set-state-in-effect.
  useEffect(() => {
    fetch(`${apiBase}?${rangeParams(range)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: ReportsData) => setData(json))
      .catch(() => {
        toast.error("Failed to load reports for this range");
        setData(EMPTY_DATA);
      })
      .finally(() => setLoading(false));
  }, [apiBase, range]);

  useEffect(() => {
    fetch(`${apiBase}/jobs?${rangeParams(jobsRange)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: JobSummaryData) => setJobsData(json))
      .catch(() => {
        toast.error("Failed to load the job summary for this range");
        setJobsData(EMPTY_JOBS);
      })
      .finally(() => setJobsLoading(false));
  }, [apiBase, jobsRange]);

  function handleRangeChange(nextPreset: RangePreset, nextRange: DateRange) {
    setLoading(true);
    setPreset(nextPreset);
    setRange(nextRange);
  }

  function handleJobsRangeChange(nextPreset: RangePreset, nextRange: DateRange) {
    setJobsLoading(true);
    setJobsPreset(nextPreset);
    setJobsRange(nextRange);
  }

  function toggleCategory(category: string) {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  const rangeKey = `${range.start ?? ""}|${range.end ?? ""}`;

  const categoryTotals = data.categories.reduce(
    (acc, c) => ({ count: acc.count + c.count, preTax: acc.preTax + c.preTax, total: acc.total + c.total }),
    { count: 0, preTax: 0, total: 0 },
  );
  const jobRows = [...jobsData.jobs, ...(jobsData.unlinked ? [jobsData.unlinked] : [])];
  const jobTotals = jobRows.reduce(
    (acc, j) => ({
      revenue: acc.revenue + j.revenue,
      expenses: acc.expenses + j.expenses,
      labor: acc.labor + j.labor,
      totalCost: acc.totalCost + j.totalCost,
      profit: acc.profit + j.profit,
    }),
    { revenue: 0, expenses: 0, labor: 0, totalCost: 0, profit: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? "default" : "outline"}
            size="sm"
            className="hover:bg-primary/10 hover:text-primary"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "jobs" ? (
        <DateRangeFilter preset={jobsPreset} range={jobsRange} onChange={handleJobsRangeChange} />
      ) : (
        <DateRangeFilter preset={preset} range={range} onChange={handleRangeChange} />
      )}

      {tab === "jobs" ? (
        jobsLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Job Summary</CardTitle>
              <p className="text-xs text-muted-foreground">
                Revenue is payments received in the range, expenses are receipts by date, labor is
                hours by work date; profit is revenue minus expenses and labor. Revenue leaves out
                invoices excluded from HST, so it lines up with the P&amp;L. Job Costing itself stays
                all-time.
              </p>
            </CardHeader>
            <CardContent>
              {jobRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No job activity in this range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Job</th>
                        <th className="px-2 py-2 text-right font-medium">Revenue</th>
                        <th className="px-2 py-2 text-right font-medium">Expenses</th>
                        <th className="px-2 py-2 text-right font-medium">Labor</th>
                        <th className="px-2 py-2 text-right font-medium">Total cost</th>
                        <th className="py-2 pl-2 text-right font-medium">Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobsData.jobs.map((j) => (
                        <JobRows key={j.jobId} row={j} />
                      ))}
                      {jobsData.unlinked && <JobRows row={jobsData.unlinked} italic />}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-semibold">
                        <td className="py-2 pr-3">Total</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(jobTotals.revenue)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(jobTotals.expenses)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(jobTotals.labor)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(jobTotals.totalCost)}</td>
                        <td className={`py-2 pl-2 text-right tabular-nums ${profitClass(jobTotals.profit)}`}>
                          {formatCurrency(jobTotals.profit)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  <p className="pt-2 text-xs text-muted-foreground">
                    Total revenue and expenses equal the P&amp;L for the same range; &quot;Not linked
                    to a job&quot; holds whatever isn&apos;t tagged to one. Labor is extra - the P&amp;L
                    doesn&apos;t include it.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )
      ) : loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : tab === "pnl" ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle className="text-base">Profit &amp; Loss</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ExpandableLine
              label="Revenue (payments received, before HST)"
              value={data.pnl.revenue}
              open={revenueOpen}
              onToggle={() => setRevenueOpen((v) => !v)}
            >
              <RevenueDetail key={rangeKey} range={range} />
            </ExpandableLine>
            <ExpandableLine
              label="Expenses (as paid, HST included)"
              value={data.pnl.expenses}
              open={expensesOpen}
              onToggle={() => setExpensesOpen((v) => !v)}
            >
              <ExpenseDetail key={rangeKey} range={range} />
            </ExpandableLine>
            <div className="mt-2 rounded-lg bg-primary/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">Net profit</span>
                <span className={`text-lg font-bold tabular-nums ${profitClass(data.pnl.netProfit)}`}>
                  {formatCurrency(data.pnl.netProfit)}
                </span>
              </div>
            </div>
            <p className="pt-2 text-xs text-muted-foreground">
              Net profit is the same Est. Profit shown on Overview for this date range. A planning
              figure, not a filed return. Revenue counts each payment in the period it was
              received, before HST, and leaves out invoices you excluded from HST. Expenses are
              your logged receipts as paid. Employee labor is job costing only, so it appears on
              the Job Summary, not here.
            </p>
          </CardContent>
        </Card>
      ) : tab === "accounts" ? (
        <AccountSpendingTab accounts={data.accounts} range={range} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expenses by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {data.categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">No expenses in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[26rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Category</th>
                      <th className="px-2 py-2 text-right font-medium">Receipts</th>
                      <th className="px-2 py-2 text-right font-medium">Before HST</th>
                      <th className="py-2 pl-2 text-right font-medium">Total paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.categories.map((c) => {
                      const open = openCategories.has(c.category);
                      return (
                        <CategoryBlock
                          key={c.category}
                          row={c}
                          open={open}
                          onToggle={() => toggleCategory(c.category)}
                          detail={<ExpenseDetail key={rangeKey} range={range} category={c.category} />}
                        />
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-semibold">
                      <td className="py-2 pr-3">Total</td>
                      <td className="px-2 py-2 text-right tabular-nums">{categoryTotals.count}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(categoryTotals.preTax)}</td>
                      <td className="py-2 pl-2 text-right tabular-nums">{formatCurrency(categoryTotals.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// "By Account": tracked spending per "Paid with" account for the selected range.
// The default view is every account (plus an always-visible "Not specified" row)
// adding up to the P&L's expenses; pick one for its total and its receipts.
// This is spending logged in TaxSnap - NOT an account balance or a statement
// total, since the app isn't connected to any bank or card.
function AccountSpendingTab({
  accounts,
  range,
}: {
  accounts: ReportsData["accounts"];
  range: DateRange;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const rangeKey = `${range.start ?? ""}|${range.end ?? ""}`;

  // A picked account can drop out of the list (deactivated, and no spend in a
  // newly chosen range) - fall back to the all-accounts view rather than error.
  const active = selected ? (accounts.rows.find((r) => r.key === selected) ?? null) : null;

  // Memoized: Select needs a stable items map (a new object every render
  // would make it re-sync on each pass).
  const items = useMemo(() => {
    const map: Record<string, string> = { all: "All accounts" };
    for (const r of accounts.rows) map[r.key] = accountRowLabel(r);
    return map;
  }, [accounts.rows]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Spending by Account</CardTitle>
        <p className="rounded-md border bg-muted/30 p-2.5 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Tracked spending only.</span> This is what
          you&apos;ve logged in TaxSnap as paid with each account - not an account balance or a
          statement total. TaxSnap isn&apos;t connected to your bank or cards.
        </p>
        <div className="max-w-xs">
          <Select
            items={items}
            value={active ? active.key : "all"}
            onValueChange={(v) => setSelected(!v || v === "all" ? null : v)}
          >
            <SelectTrigger aria-label="Account" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.rows.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {accountRowLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {active ? (
          <>
            <div className="rounded-lg bg-primary/10 p-3">
              <p className="text-xs text-muted-foreground">
                {active.key === NOT_SPECIFIED
                  ? "Tracked spending with no account chosen, in this range"
                  : `Tracked spending paid with ${active.name} in this range`}
              </p>
              <p className="text-2xl font-bold tabular-nums">{formatCurrency(active.total)}</p>
              <p className="text-xs text-muted-foreground">
                {active.count} expense{active.count === 1 ? "" : "s"}
              </p>
            </div>
            <ExpenseDetail key={`${rangeKey}|${active.key}`} range={range} account={active.key} />
          </>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="px-2 py-2 text-right font-medium">Expenses</th>
                  <th className="py-2 pl-2 text-right font-medium">Tracked spending</th>
                </tr>
              </thead>
              <tbody>
                {accounts.rows.map((r) => (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => setSelected(r.key)}
                        className="flex items-center gap-1.5 text-left font-medium hover:text-primary"
                      >
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {accountRowLabel(r)}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.count}</td>
                    <td className="py-2 pl-2 text-right tabular-nums">{formatCurrency(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-semibold">
                  <td className="py-2 pr-3">Total tracked spending</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {accounts.rows.reduce((sum, r) => sum + r.count, 0)}
                  </td>
                  <td className="py-2 pl-2 text-right tabular-nums">
                    {formatCurrency(accounts.total)}
                  </td>
                </tr>
              </tfoot>
            </table>
            <p className="pt-2 text-xs text-muted-foreground">
              &quot;Not specified&quot; is expenses with no &quot;Paid with&quot; chosen. They&apos;re
              counted here so the total equals the P&amp;L&apos;s expenses for the same range.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function accountRowLabel(r: AccountSpendRow): string {
  let label = r.name;
  if (r.type === "card") label += " (credit card)";
  if (!r.isActive && r.key !== NOT_SPECIFIED) label += " (inactive)";
  return label;
}

// A category row plus, when expanded, a full-width row holding its receipts.
function CategoryBlock({
  row,
  open,
  onToggle,
  detail,
}: {
  row: ReportsData["categories"][number];
  open: boolean;
  onToggle: () => void;
  detail: React.ReactNode;
}) {
  return (
    <>
      <tr className="border-b last:border-0">
        <td className="py-2 pr-3 font-medium">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex items-center gap-1.5 text-left hover:text-primary"
          >
            {open ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            {row.category}
            {row.isCustom && (
              <span className="ml-1 text-xs font-normal text-muted-foreground">custom</span>
            )}
          </button>
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{row.count}</td>
        <td className="px-2 py-2 text-right tabular-nums">{formatCurrency(row.preTax)}</td>
        <td className="py-2 pl-2 text-right tabular-nums">{formatCurrency(row.total)}</td>
      </tr>
      {open && (
        <tr className="border-b last:border-0">
          <td colSpan={4} className="bg-muted/20 p-2">
            {detail}
          </td>
        </tr>
      )}
    </>
  );
}
