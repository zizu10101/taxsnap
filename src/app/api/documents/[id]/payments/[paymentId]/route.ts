import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import type { DocumentStatus } from "@/lib/database.types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function statusFromPaid(paid: number, total: number): DocumentStatus {
  if (paid <= 0) return "sent";
  if (paid >= total) return "paid";
  return "partial";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id, paymentId } = await params;

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
  const update: {
    amount?: number;
    paid_date?: string;
    method?: string | null;
    note?: string | null;
  } = {};

  if (body.amount !== undefined) {
    const amount = round2(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Payment amount must be greater than $0." },
        { status: 400 },
      );
    }

    // Same overpayment guard as POST, but excluding this payment's own
    // current amount from the existing total - otherwise editing a
    // payment would immediately trip the guard against itself.
    const { data: otherPayments } = await supabase
      .from("payments")
      .select("amount")
      .eq("document_id", id)
      .neq("id", paymentId);

    const otherTotal = round2(
      (otherPayments ?? []).reduce((sum, p) => sum + p.amount, 0),
    );
    const remaining = round2(document.total_amount - otherTotal);

    if (amount > remaining + 0.001) {
      const over = round2(amount - remaining);
      return NextResponse.json(
        {
          error: `This payment would exceed the invoice total by $${over.toFixed(2)} — edit the invoice or adjust the payment amount.`,
        },
        { status: 400 },
      );
    }

    update.amount = amount;
  }
  if (body.paid_date !== undefined) update.paid_date = body.paid_date;
  if (body.method !== undefined) update.method = body.method?.trim() || null;
  if (body.note !== undefined) update.note = body.note?.trim() || null;

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .update(update)
    .eq("id", paymentId)
    .eq("document_id", id)
    .select()
    .single();

  if (paymentError) {
    return NextResponse.json({ error: paymentError.message }, { status: 500 });
  }

  const { data: allPayments } = await supabase
    .from("payments")
    .select("amount")
    .eq("document_id", id);

  const totalPaid = round2(
    (allPayments ?? []).reduce((sum, p) => sum + p.amount, 0),
  );

  const nextStatus =
    document.status === "draft" && totalPaid <= 0
      ? "draft"
      : statusFromPaid(totalPaid, document.total_amount);

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

  return NextResponse.json({ payment, document: updatedDocument });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id, paymentId } = await params;

  const { data: document } = await supabase
    .from("documents")
    .select("id, total_amount, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("payments")
    .delete()
    .eq("id", paymentId)
    .eq("document_id", id);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const { data: allPayments } = await supabase
    .from("payments")
    .select("amount")
    .eq("document_id", id);

  const totalPaid = round2(
    (allPayments ?? []).reduce((sum, p) => sum + p.amount, 0),
  );

  // A draft was never "sent" in the first place - don't bump it forward
  // just because a stray payment record on it got deleted.
  const nextStatus =
    document.status === "draft" && totalPaid <= 0
      ? "draft"
      : statusFromPaid(totalPaid, document.total_amount);

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

  return NextResponse.json({ document: updatedDocument });
}
