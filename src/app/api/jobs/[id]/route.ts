import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import type { JobUpdate } from "@/lib/database.types";

// Job detail + cost rollup. Total job cost = sum of tagged expenses
// (receipts.total_amount) + sum of labor cost (hour_entries.labor_cost).
// Labor cost never touches the HST/tax tables - this route only reads
// receipts/hour_entries, nothing from sales/documents/payments.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
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
  // Reference only, same reasoning as job-detail.tsx - never added into
  // totalJobCost/revenue here, to avoid double-counting once this labor
  // is actually invoiced and paid.
  const totalLaborRevenue = (hourEntries ?? []).reduce((sum, h) => sum + h.labor_revenue, 0);

  return NextResponse.json({
    job,
    receipts: receipts ?? [],
    hourEntries: hourEntries ?? [],
    totals: {
      totalExpenses,
      totalLaborCost,
      totalLaborRevenue,
      totalJobCost: totalExpenses + totalLaborCost,
    },
  });
}

// No general job-rename/edit UI exists yet - this is scoped to just
// contract_value, the one field progress billing needs to set (via the
// Progress Billing tab's own "Start Progress Billing" flow). Setting it
// on an already-capped job doesn't consume a new job slot - it's an edit
// to an existing row, not a create.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const body = await request.json();
  const { contract_value } = body ?? {};

  const update: JobUpdate = {};
  if (contract_value !== undefined) {
    update.contract_value = contract_value === null ? null : Number(contract_value) || 0;
  }

  const { data, error } = await supabase
    .from("jobs")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ job: data });
}
