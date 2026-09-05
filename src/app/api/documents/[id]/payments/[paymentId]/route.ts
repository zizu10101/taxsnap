import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import type { DocumentStatus } from "@/lib/database.types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function statusFromPaid(paid: number, total: number): DocumentStatus {
  if (paid <= 0) return "sent";
  if (paid >= total) return "paid";
  return "partial";
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
  const result = await requireProUser();
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
