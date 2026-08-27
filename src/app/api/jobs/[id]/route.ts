import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";

// Job detail + cost rollup. Total job cost = sum of tagged expenses
// (receipts.total_amount) + sum of labor cost (hour_entries.labor_cost).
// Labor cost never touches the HST/tax tables - this route only reads
// receipts/hour_entries, nothing from sales/documents/payments.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;
  const { id } = await params;

  const [{ data: job, error: jobError }, { data: receipts }, { data: hourEntries }] =
    await Promise.all([
      supabase.from("jobs").select("*").eq("id", id).single(),
      supabase
        .from("receipts")
        .select("id, merchant_name, transaction_date, total_amount, tax_category")
        .eq("job_id", id)
        .order("transaction_date", { ascending: false }),
      supabase
        .from("hour_entries")
        .select("*, employee:employees(*)")
        .eq("job_id", id)
        .order("work_date", { ascending: false }),
    ]);

  if (jobError || !job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const totalExpenses = (receipts ?? []).reduce((sum, r) => sum + r.total_amount, 0);
  const totalLaborCost = (hourEntries ?? []).reduce((sum, h) => sum + h.labor_cost, 0);

  return NextResponse.json({
    job,
    receipts: receipts ?? [],
    hourEntries: hourEntries ?? [],
    totals: {
      totalExpenses,
      totalLaborCost,
      totalJobCost: totalExpenses + totalLaborCost,
    },
  });
}
