import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Logs a change order (+/- delta) against an already-progress-billed
// job, then applies that same delta to jobs.contract_value - the one
// place contract_value is ever adjusted after the initial "Start
// Progress Billing" set (see PATCH /api/jobs/[id]). The log row is
// inserted first, then the job total is updated - if the update step
// ever failed, the log entry staying in place is the safer half to keep
// (the audit trail), matching how POST /api/documents/[id]/payments
// orders its own insert-then-roll-up-update.
export async function POST(
  request: Request,
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
    .select("id, contract_value")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!job || job.contract_value === null) {
    return NextResponse.json(
      { error: "This job isn't progress-billed yet." },
      { status: 404 },
    );
  }

  const body = await request.json();
  const amount = round2(Number(body.amount));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const changedAt = typeof body.changed_at === "string" && body.changed_at ? body.changed_at : undefined;

  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json(
      { error: "Enter a non-zero amount (positive to add, negative to reduce)." },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json({ error: "Enter a reason for this change." }, { status: 400 });
  }

  const { data: change, error: changeError } = await supabase
    .from("contract_changes")
    .insert({
      job_id: id,
      amount,
      reason,
      changed_at: changedAt,
    })
    .select()
    .single();

  if (changeError) {
    return NextResponse.json({ error: changeError.message }, { status: 500 });
  }

  const newContractValue = round2(job.contract_value + amount);
  const { data: updatedJob, error: updateError } = await supabase
    .from("jobs")
    .update({ contract_value: newContractValue })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ change, job: updatedJob }, { status: 201 });
}
