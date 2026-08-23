import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { InvoiceLineItem } from "@/lib/database.types";

async function requireProUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized" as const, status: 401 as const };

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", user.id)
    .single();

  if (profile?.subscription_status !== "pro") {
    return {
      error: "Invoicing is a Pro feature. Upgrade to unlock it." as const,
      status: 403 as const,
    };
  }

  return { supabase, user };
}

export async function GET() {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { data, error } = await result.supabase
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ invoices: data });
}

export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const body = await request.json();
  const { client_name, client_email, line_items } = body as {
    client_name?: string;
    client_email?: string;
    line_items?: InvoiceLineItem[];
  };

  if (!client_name || !line_items?.length) {
    return NextResponse.json(
      { error: "client_name and at least one line item are required." },
      { status: 400 },
    );
  }

  const total_amount = line_items.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0,
  );

  const { data, error } = await result.supabase
    .from("invoices")
    .insert({
      user_id: result.user.id,
      client_name,
      client_email: client_email || null,
      line_items,
      total_amount,
      status: "draft",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ invoice: data }, { status: 201 });
}
