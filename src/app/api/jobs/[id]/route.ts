import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { getNextContractNumber } from "@/lib/contract-number";
import type { JobUpdate } from "@/lib/database.types";
import { findJobByName, duplicateJobMessage, isUniqueViolation } from "@/lib/find-by-name";
import { validateJobPatch } from "@/lib/job-fields";
import { jobDeleteBlocker } from "@/lib/job-delete";

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

// Edits a job (EditJobDialog: name, location, customer, contract value, retainage) and sets
// contract_value/retainage_rate (the Progress Billing tab's own "Start Progress Billing" flow).
// Every rule lives in lib/job-fields.ts (tested): contract value must be a real positive amount,
// retainage 0-100, and once the job has progress draws or change orders the contract numbers are
// frozen (change orders are the only way to move contract_value from then on). Editing an
// already-capped job doesn't consume a new job slot - it's an edit to an existing row, not a
// create. Renames are case-insensitively unique per account, excluding the job being renamed
// ("abc" -> "ABC" is fine).
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

  const body = await request.json().catch(() => null);

  const [{ data: current }, { count: drawCount }, { count: changeCount }] = await Promise.all([
    supabase
      .from("jobs")
      .select("contract_value, contract_number, retainage_rate")
      .eq("id", id)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("job_id", id)
      .eq("user_id", user.id)
      .eq("is_progress_draw", true),
    supabase
      .from("contract_changes")
      .select("id", { count: "exact", head: true })
      .eq("job_id", id),
  ]);
  if (!current) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const checked = validateJobPatch(body, current, {
    hasDraws: (drawCount ?? 0) > 0,
    hasChanges: (changeCount ?? 0) > 0,
  });
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error }, { status: checked.status });
  }
  const update: JobUpdate = { ...checked.update };

  if (typeof update.name === "string" && (await findJobByName(supabase, user.id, update.name, id))) {
    return NextResponse.json({ error: duplicateJobMessage(update.name) }, { status: 409 });
  }

  // A FK alone proves the client exists, not that it is this owner's.
  if (typeof update.client_id === "string") {
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("id", update.client_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!client) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }

  // Assigned exactly once, the moment a job becomes progress-billed
  // (contract_value going from null to a real value) - never reassigned
  // after, same as document_number.
  if (
    typeof update.contract_value === "number" &&
    current.contract_value === null &&
    current.contract_number === null
  ) {
    update.contract_number = await getNextContractNumber(supabase, user.id);
  }

  if (Object.keys(update).length === 0) {
    const { data: unchanged } = await supabase.from("jobs").select("*").eq("id", id).single();
    return NextResponse.json({ job: unchanged });
  }

  const { data, error } = await supabase
    .from("jobs")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (isUniqueViolation(error) && typeof update.name === "string") {
    return NextResponse.json({ error: duplicateJobMessage(update.name) }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ job: data });
}

// Hard-deletes a job - the same pattern as documents/payments/clients (only employees and
// stylists are "deactivated", because history needs their row; a job is just a label). It never
// deletes what points at it: documents, expenses and expense templates are unlinked by the
// foreign keys (`on delete set null`), and the delete is REFUSED (409) while the job has progress
// draws, change orders, a document with payments, or hours / clock sessions. See lib/job-delete.ts.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const [documents, changeOrders, hourEntries, timeSessions, expenses, templates] =
    await Promise.all([
      supabase
        .from("documents")
        .select("id, is_progress_draw, payments(id)")
        .eq("job_id", id)
        .eq("user_id", user.id),
      supabase.from("contract_changes").select("id", { count: "exact", head: true }).eq("job_id", id),
      supabase
        .from("hour_entries")
        .select("id", { count: "exact", head: true })
        .eq("job_id", id)
        .eq("user_id", user.id),
      supabase
        .from("time_sessions")
        .select("id", { count: "exact", head: true })
        .eq("job_id", id)
        .eq("user_id", user.id),
      supabase
        .from("receipts")
        .select("id", { count: "exact", head: true })
        .eq("job_id", id)
        .eq("user_id", user.id),
      supabase
        .from("expense_templates")
        .select("id", { count: "exact", head: true })
        .eq("job_id", id)
        .eq("user_id", user.id),
    ]);

  const failed = [documents, changeOrders, hourEntries, timeSessions, expenses, templates].find(
    (r) => r.error,
  );
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const docs = (documents.data ?? []) as { is_progress_draw: boolean; payments: { id: string }[] }[];
  const blocker = jobDeleteBlocker({
    draws: docs.filter((d) => d.is_progress_draw).length,
    changeOrders: changeOrders.count ?? 0,
    documentsWithPayments: docs.filter((d) => d.payments.length > 0).length,
    hourEntries: hourEntries.count ?? 0,
    timeSessions: timeSessions.count ?? 0,
  });
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });

  const { error } = await supabase.from("jobs").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    unlinked: {
      documents: docs.length,
      expenses: expenses.count ?? 0,
      templates: templates.count ?? 0,
    },
  });
}
