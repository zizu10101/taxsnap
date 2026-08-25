import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { ONTARIO_HST_RATE } from "@/lib/hst";
import type { DocumentStatus, DocumentType, DocumentUpdate } from "@/lib/database.types";

const DOCUMENT_TYPES: DocumentType[] = ["invoice", "estimate"];
const DOCUMENT_STATUSES: DocumentStatus[] = ["draft", "sent", "partial", "paid"];

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

interface ItemInput {
  description: string;
  quantity: number;
  unit_price: number;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;

  const { data: document, error } = await result.supabase
    .from("documents")
    .select("*, client:clients(*), payments(*), items:document_items(*)")
    .eq("id", id)
    .eq("user_id", result.user.id)
    .single();

  if (error || !document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json({ document });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const { data: existing } = await supabase
    .from("documents")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const body = await request.json();
  const updates: DocumentUpdate = {
    updated_at: new Date().toISOString(),
  };

  if (body.type && DOCUMENT_TYPES.includes(body.type)) updates.type = body.type;
  if (body.status && DOCUMENT_STATUSES.includes(body.status)) {
    updates.status = body.status;
  }
  if (body.issue_date) updates.issue_date = body.issue_date;
  if (body.due_date !== undefined) updates.due_date = body.due_date || null;
  if (typeof body.excluded_from_hst === "boolean") {
    updates.excluded_from_hst = body.excluded_from_hst;
  }

  let clientId: string | undefined = body.client_id ?? undefined;
  if (!clientId && body.new_client?.name?.trim()) {
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .insert({
        user_id: user.id,
        name: body.new_client.name.trim(),
        email: body.new_client.email?.trim() || null,
        address: body.new_client.address?.trim() || null,
      })
      .select()
      .single();

    if (clientError) {
      return NextResponse.json({ error: clientError.message }, { status: 500 });
    }
    clientId = client.id;
  }
  if (clientId !== undefined) updates.client_id = clientId;

  const cleanItems: ItemInput[] | null = Array.isArray(body.items)
    ? body.items.filter((i: ItemInput) => i?.description?.trim())
    : null;

  if (cleanItems) {
    if (cleanItems.length === 0) {
      return NextResponse.json(
        { error: "At least one line item is required." },
        { status: 400 },
      );
    }
    const subtotal = round2(
      cleanItems.reduce(
        (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0),
        0,
      ),
    );
    const hstAmount = round2(subtotal * ONTARIO_HST_RATE);
    updates.subtotal = subtotal;
    updates.hst_amount = hstAmount;
    updates.total_amount = round2(subtotal + hstAmount);
  }

  const { data: document, error: updateError } = await supabase
    .from("documents")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*, client:clients(*), payments(*)")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  let items = null;
  if (cleanItems) {
    await supabase.from("document_items").delete().eq("document_id", id);
    const { data: insertedItems, error: itemsError } = await supabase
      .from("document_items")
      .insert(
        cleanItems.map((item, index) => ({
          document_id: id,
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
    items = insertedItems;
  } else {
    const { data: existingItems } = await supabase
      .from("document_items")
      .select("*")
      .eq("document_id", id)
      .order("sort_order", { ascending: true });
    items = existingItems ?? [];
  }

  return NextResponse.json({ document: { ...document, items } });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;

  const { error } = await result.supabase
    .from("documents")
    .delete()
    .eq("id", id)
    .eq("user_id", result.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
