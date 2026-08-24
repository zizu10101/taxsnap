import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";

// Duplicates an estimate as a new draft invoice, carrying over the client
// and line items. The original estimate is left untouched.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const { data: estimate, error: fetchError } = await supabase
    .from("documents")
    .select("*, items:document_items(*)")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("type", "estimate")
    .single();

  if (fetchError || !estimate) {
    return NextResponse.json({ error: "Estimate not found." }, { status: 404 });
  }

  const { data: invoice, error: insertError } = await supabase
    .from("documents")
    .insert({
      user_id: user.id,
      client_id: estimate.client_id,
      type: "invoice",
      status: "draft",
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: estimate.due_date,
      subtotal: estimate.subtotal,
      hst_amount: estimate.hst_amount,
      total_amount: estimate.total_amount,
      converted_from_id: estimate.id,
    })
    .select("*, client:clients(*)")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const items = estimate.items ?? [];
  const { data: insertedItems, error: itemsError } = await supabase
    .from("document_items")
    .insert(
      items.map(
        (item: { description: string; quantity: number; unit_price: number; sort_order: number }) => ({
          document_id: invoice.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          sort_order: item.sort_order,
        }),
      ),
    )
    .select();

  if (itemsError) {
    await supabase.from("documents").delete().eq("id", invoice.id);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  return NextResponse.json(
    { document: { ...invoice, items: insertedItems } },
    { status: 201 },
  );
}
