import type { Metadata } from "next";
import { ReportsView } from "@/components/reports/reports-view";
import { getAccountantPageContext } from "@/lib/accountant-page";
import { getJobSummary, getReportsData } from "@/lib/reports-query";
import { getPresetRange } from "@/lib/date-range";

export const metadata: Metadata = {
  title: "Reports — Accountant access — TaxSnap",
};

// The same ReportsView the owner uses (P&L, Job Summary, Expenses by Category,
// By Account, with the same date-range filters and drill-downs), pointed at the
// read-only accountant API. Seeded with the same defaults as the owner's page.
export default async function AccountantReportsPage() {
  const ctx = await getAccountantPageContext();
  if (!ctx.available) return null;

  const defaultRange = getPresetRange("this-month");
  const [initialData, initialJobs] = await Promise.all([
    getReportsData(ctx.db, defaultRange.start, defaultRange.end),
    getJobSummary(ctx.db, null, null),
  ]);

  return (
    <ReportsView
      initialData={initialData}
      initialJobs={initialJobs}
      endpoints={{
        apiBase: "/api/accountant-portal/reports",
        documentBase: "/accountant/invoices",
      }}
    />
  );
}
