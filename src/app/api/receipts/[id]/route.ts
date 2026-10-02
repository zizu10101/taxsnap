import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveCategory } from "@/lib/expense-categories";
import { resolvePaidWithAccountId } from "@/lib/payments";
import type { ReceiptItem } from "@/lib/database.types";

function sanitizeItems(items: unknown): ReceiptItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is ReceiptItem => !!item?.name?.trim())
    .map((item) => ({
      name: item.name.trim(),
      amount: Number(item.amount) || 0,
    }));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const {
    merchant_name,
    transaction_date,
    total_amount,
    tax_amount,
    tax_category,
    items,
    job_name,
    paid_with_account_id,
  } = body ?? {};

  if (!merchant_name || !transaction_date || total_amount === undefined) {
    return NextResponse.json(
      { error: "merchant_name, transaction_date, and total_amount are required." },
      { status: 400 },
    );
  }

  const category = await resolveCategory(supabase, user.id, tax_category);

  // Only touched when the client sent the field; an explicit null/"" clears it.
  const paidWith = await resolvePaidWithAccountId(supabase, user.id, paid_with_account_id);
  if ("error" in paidWith) {
    return NextResponse.json({ error: paidWith.error }, { status: paidWith.status });
  }

  const { data, error } = await supabase
    .from("receipts")
    .update({
      merchant_name,
      transaction_date,
      total_amount: Number(total_amount) || 0,
      tax_amount: Number(tax_amount) || 0,
      tax_category: category,
      job_name: job_name?.trim() || null,
      ...(paid_with_account_id !== undefined && { paid_with_account_id: paidWith.id }),
      items: sanitizeItems(items),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ receipt: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const { data: receipt } = await supabase
    .from("receipts")
    .select("image_url")
    .eq("id", id)
    .single();

  const { error } = await supabase
    .from("receipts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (receipt?.image_url) {
    await supabase.storage.from("receipts").remove([receipt.image_url]);
  }

  return NextResponse.json({ success: true });
}
