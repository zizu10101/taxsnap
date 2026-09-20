import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { round2, statusFromPaid } from "@/lib/payments";

// Records one payment against the CONTRACT rather than a specific draw -
// the common case of a client paying down held-back balance across
// several draws at once. Not a new kind of payment record: it's just N
// ordinary payments.insert calls, one per draw touched, fanned out
// oldest-unpaid-first (draw_number ascending - that ordering already
// *is* chronological, draw numbers are assigned sequentially). Zero
// schema changes needed for this reason.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id: jobId } = await params;

  const { data: job } = await supabase
    .from("jobs")
    .select("id, contract_value")
    .eq("id", jobId)
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
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "Payment amount must be greater than $0." },
      { status: 400 },
    );
  }

  const { data: draws } = await supabase
    .from("documents")
    .select("id, document_number, draw_number, total_amount, payments(amount)")
    .eq("job_id", jobId)
    .eq("is_progress_draw", true)
    .order("draw_number", { ascending: true });

  const outstandingDraws = (draws ?? [])
    .map((d) => ({
      id: d.id,
      documentNumber: d.document_number,
      drawNumber: d.draw_number,
      totalAmount: d.total_amount,
      paidSoFar: round2(d.payments.reduce((sum, p) => sum + p.amount, 0)),
    }))
    .map((d) => ({ ...d, outstanding: round2(d.totalAmount - d.paidSoFar) }))
    .filter((d) => d.outstanding > 0.001);

  const totalOutstanding = round2(
    outstandingDraws.reduce((sum, d) => sum + d.outstanding, 0),
  );

  // Same overpayment-guard philosophy as the per-draw payment route,
  // just totaled across every draw on the contract instead of one
  // document - never let a payment exceed what's actually owed.
  if (amount > totalOutstanding + 0.001) {
    const over = round2(amount - totalOutstanding);
    return NextResponse.json(
      {
        error: `This payment would exceed the total outstanding across all draws by $${over.toFixed(2)} — adjust the amount.`,
      },
      { status: 400 },
    );
  }

  let remaining = amount;
  const allocations: {
    drawId: string;
    documentNumber: number;
    drawNumber: number | null;
    amountApplied: number;
    newStatus: string;
  }[] = [];

  for (const draw of outstandingDraws) {
    if (remaining <= 0.001) break;
    const applied = round2(Math.min(remaining, draw.outstanding));
    if (applied <= 0.001) continue;

    const { error: paymentError } = await supabase.from("payments").insert({
      document_id: draw.id,
      amount: applied,
      paid_date: body.paid_date || undefined,
      method: body.method?.trim() || null,
      note: body.note?.trim() || null,
    });
    if (paymentError) {
      return NextResponse.json({ error: paymentError.message }, { status: 500 });
    }

    const newStatus = statusFromPaid(round2(draw.paidSoFar + applied), draw.totalAmount);
    const { error: statusError } = await supabase
      .from("documents")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", draw.id)
      .eq("user_id", user.id);
    if (statusError) {
      return NextResponse.json({ error: statusError.message }, { status: 500 });
    }

    allocations.push({
      drawId: draw.id,
      documentNumber: draw.documentNumber,
      drawNumber: draw.drawNumber,
      amountApplied: applied,
      newStatus,
    });
    remaining = round2(remaining - applied);
  }

  return NextResponse.json({ allocations, totalApplied: round2(amount - remaining) });
}
