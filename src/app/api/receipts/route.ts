import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TAX_CATEGORIES } from "@/lib/tax-categories";
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    merchant_name,
    transaction_date,
    total_amount,
    tax_amount,
    tax_category,
    items,
    image_path,
    job_name,
  } = body ?? {};

  if (!merchant_name || !transaction_date || total_amount === undefined) {
    return NextResponse.json(
      { error: "merchant_name, transaction_date, and total_amount are required." },
      { status: 400 },
    );
  }

  const category = TAX_CATEGORIES.includes(tax_category) ? tax_category : "Other";

  const { data, error } = await supabase
    .from("receipts")
    .insert({
      user_id: user.id,
      image_url: image_path ?? null,
      merchant_name,
      transaction_date,
      total_amount: Number(total_amount) || 0,
      tax_amount: Number(tax_amount) || 0,
      tax_category: category,
      job_name: job_name?.trim() || null,
      items: sanitizeItems(items),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ receipt: data }, { status: 201 });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .order("transaction_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ receipts: data });
}
