import { NextResponse } from "next/server";
import { requireBasicUser, requireUser } from "@/lib/require-pro";

// Manual sales entry is unrestricted for salon accounts at every tier -
// it's always been a general-purpose "other revenue" field, and salon
// accounts have used it unrestricted since day one (their real revenue
// tracking is Commission; this is just supplementary). Only general-
// business accounts are newly gated to Basic-or-higher, so business_type
// is checked first and requireBasicUser() is only invoked (and only pays
// for its own profile query) when it's actually needed.
async function requireSalesAccess() {
  const authResult = await requireUser();
  if ("error" in authResult) return authResult;
  const { supabase, user } = authResult;

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_type")
    .eq("id", user.id)
    .single();

  if (profile?.business_type !== "salon") {
    const tierResult = await requireBasicUser();
    if ("error" in tierResult) return tierResult;
  }

  return { supabase, user };
}

export async function GET() {
  const result = await requireSalesAccess();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const { data, error } = await supabase.from("sales").select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sales: data });
}

export async function POST(request: Request) {
  const result = await requireSalesAccess();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const { period_label, gross_sales, cash_deposits } = body ?? {};

  if (!period_label) {
    return NextResponse.json(
      { error: "period_label is required." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("sales")
    .upsert(
      {
        user_id: user.id,
        period_label,
        gross_sales: Number(gross_sales) || 0,
        cash_deposits: Number(cash_deposits) || 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,period_label" },
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sales: data });
}
