import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { round2 } from "@/lib/payments";

interface ItemInput {
  description: string;
  quantity: number;
  unit_price: number;
}

// Edits/deletes a change order, or links it to the draw it was billed
// through ("Bill this Change Order"). Simplified lock rule: once
// billed_document_id is set, no further edit or delete - full stop.
// (RLS's own update/delete policies on contract_changes enforce this
// same condition at the DB level too, as a backstop behind this check.)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; changeId: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id: jobId, changeId } = await params;

  const { data: job } = await supabase
    .from("jobs")
    .select("id, contract_value")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .single();

  if (!job || job.contract_value === null) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("contract_changes")
    .select("id, amount, billed_document_id")
    .eq("id", changeId)
    .eq("job_id", jobId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Change order not found." }, { status: 404 });
  }

  const body = await request.json();

  // "Bill this Change Order" - links to the draw just created for it.
  // Doesn't touch amount/contract_value (that was already applied when
  // the change order was first logged); billing just records which
  // invoice carries it.
  if ("billed_document_id" in body) {
    if (existing.billed_document_id !== null) {
      return NextResponse.json(
        { error: "This change order has already been billed." },
        { status: 400 },
      );
    }
    const { data: updated, error } = await supabase
      .from("contract_changes")
      .update({ billed_document_id: body.billed_document_id })
      .eq("id", changeId)
      .select("*, items:contract_change_items(*)")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ change: updated });
  }

  // Content edit (items/reason/date) - only while still unbilled.
  if (existing.billed_document_id !== null) {
    return NextResponse.json(
      { error: "This change order has been billed and can no longer be edited." },
      { status: 403 },
    );
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const changedAt = typeof body.changed_at === "string" ? body.changed_at : undefined;
  const items: ItemInput[] = Array.isArray(body.items)
    ? body.items.filter((i: ItemInput) => i?.description?.trim())
    : [];

  if (!reason) {
    return NextResponse.json({ error: "Enter a reason for this change." }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "Add at least one line item." }, { status: 400 });
  }

  const amount = round2(
    items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0),
  );
  if (amount === 0) {
    return NextResponse.json(
      { error: "The line items must total a non-zero amount." },
      { status: 400 },
    );
  }

  const { error: updateError } = await supabase
    .from("contract_changes")
    .update({ amount, reason, changed_at: changedAt })
    .eq("id", changeId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await supabase.from("contract_change_items").delete().eq("contract_change_id", changeId);
  const { error: itemsError } = await supabase.from("contract_change_items").insert(
    items.map((item, index) => ({
      contract_change_id: changeId,
      description: item.description.trim(),
      quantity: Number(item.quantity) || 0,
      unit_price: Number(item.unit_price) || 0,
      sort_order: index,
    })),
  );

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  // Adjust contract_value by the delta between the old and new total,
  // not a blind overwrite - other change orders' own deltas must stay
  // intact.
  const delta = round2(amount - existing.amount);
  const { data: updatedJob, error: jobError } = await supabase
    .from("jobs")
    .update({ contract_value: round2(job.contract_value + delta) })
    .eq("id", jobId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  const { data: change } = await supabase
    .from("contract_changes")
    .select("*, items:contract_change_items(*)")
    .eq("id", changeId)
    .single();

  return NextResponse.json({ change, job: updatedJob });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; changeId: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id: jobId, changeId } = await params;

  const { data: job } = await supabase
    .from("jobs")
    .select("id, contract_value")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .single();

  if (!job || job.contract_value === null) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("contract_changes")
    .select("id, amount, billed_document_id")
    .eq("id", changeId)
    .eq("job_id", jobId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Change order not found." }, { status: 404 });
  }
  if (existing.billed_document_id !== null) {
    return NextResponse.json(
      { error: "This change order has been billed and can no longer be deleted." },
      { status: 403 },
    );
  }

  const { error: deleteError } = await supabase
    .from("contract_changes")
    .delete()
    .eq("id", changeId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const { data: updatedJob, error: jobError } = await supabase
    .from("jobs")
    .update({ contract_value: round2(job.contract_value - existing.amount) })
    .eq("id", jobId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  return NextResponse.json({ job: updatedJob });
}
