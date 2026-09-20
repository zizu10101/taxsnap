import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { round2 } from "@/lib/payments";

interface ItemInput {
  description: string;
  quantity: number;
  unit_price: number;
}

// Logs a change order against an already-progress-billed job, then
// applies its total to jobs.contract_value - the one place
// contract_value is ever adjusted after the initial "Start Progress
// Billing" set (see PATCH /api/jobs/[id]). Real line items now (same
// shape as document_items), not a single typed amount - the total is
// computed from them, same "store the computed total, derive it from
// items on every write" pattern documents.subtotal already uses. A
// reduction/credit is just a negative unit_price on an item.
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
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const changedAt =
    typeof body.changed_at === "string" && body.changed_at ? body.changed_at : undefined;
  const items: ItemInput[] = Array.isArray(body.items)
    ? body.items.filter((i: ItemInput) => i?.description?.trim())
    : [];

  if (!reason) {
    return NextResponse.json({ error: "Enter a reason for this change." }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json(
      { error: "Add at least one line item." },
      { status: 400 },
    );
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

  const { data: change, error: changeError } = await supabase
    .from("contract_changes")
    .insert({ job_id: id, amount, reason, changed_at: changedAt })
    .select()
    .single();

  if (changeError) {
    return NextResponse.json({ error: changeError.message }, { status: 500 });
  }

  const { data: insertedItems, error: itemsError } = await supabase
    .from("contract_change_items")
    .insert(
      items.map((item, index) => ({
        contract_change_id: change.id,
        description: item.description.trim(),
        quantity: Number(item.quantity) || 0,
        unit_price: Number(item.unit_price) || 0,
        sort_order: index,
      })),
    )
    .select();

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
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

  return NextResponse.json(
    { change: { ...change, items: insertedItems }, job: updatedJob },
    { status: 201 },
  );
}
