import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import type { DocumentStatus } from "@/lib/database.types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Recomputes a document's status from its payment total rather than
// trusting the client - a deposit only ever brings it to "partial", and it
// only reaches "paid" once payments cover the full total.
function statusFromPaid(paid: number, total: number): DocumentStatus {
  if (paid <= 0) return "sent";
  if (paid >= total) return "paid";
  return "partial";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const { data: document } = await supabase
    .from("documents")
    .select("id, total_amount, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const body = await request.json();
  const amount = round2(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "Payment amount must be greater than $0." },
      { status: 400 },
    );
  }

  // Overpayment guard - checked against every existing payment's sum, not
  // just this one in isolation, so it also catches the case where several
  // smaller payments would together exceed the total (not just one payment
  // that's too large on its own). Checked before inserting rather than
  // insert-then-roll-back, so a rejected payment never touches the table
  // at all. The server is authoritative here - document-detail.tsx also
  // checks client-side for instant feedback, but that alone can't be
  // trusted (a stale balanceDue in the browser, or a direct API call).
  const { data: existingPayments } = await supabase
    .from("payments")
    .select("amount")
    .eq("document_id", id);

  const existingTotal = round2(
    (existingPayments ?? []).reduce((sum, p) => sum + p.amount, 0),
  );
  const remaining = round2(document.total_amount - existingTotal);

  if (amount > remaining + 0.001) {
    const over = round2(amount - remaining);
    return NextResponse.json(
      {
        error: `This payment would exceed the invoice total by $${over.toFixed(2)} — edit the invoice or adjust the payment amount.`,
      },
      { status: 400 },
    );
  }

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .insert({
      document_id: id,
      amount,
      paid_date: body.paid_date || undefined,
      method: body.method?.trim() || null,
      note: body.note?.trim() || null,
    })
    .select()
    .single();

  if (paymentError) {
    return NextResponse.json({ error: paymentError.message }, { status: 500 });
  }

  const totalPaid = round2(existingTotal + amount);
  const nextStatus = statusFromPaid(totalPaid, document.total_amount);

  const { data: updatedDocument, error: updateError } = await supabase
    .from("documents")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*, client:clients(*), job:jobs(*), payments(*)")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ payment, document: updatedDocument }, { status: 201 });
}
