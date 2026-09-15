import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { wouldExceedMonthlyLimit, limitReachedMessage } from "@/lib/plan-limits";

export async function GET() {
  const result = await requireUser();
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
  const result = await requireUser();
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

  // Manual sales entry is unrestricted for salon accounts at every tier -
  // it's always been a general-purpose "other revenue" field, and salon
  // accounts have used it unrestricted since day one (their real revenue
  // tracking is Commission; this is just supplementary). General-business
  // accounts get a capped number of new entries per month instead (see
  // src/lib/plan-limits.ts) - checked only when this period_label doesn't
  // already exist, so editing an already-saved period's figures never
  // counts against the cap, only starting a genuinely new one does.
  const { data: profile } = await supabase
    .from("profiles")
    .select("business_type")
    .eq("id", user.id)
    .single();

  if (profile?.business_type !== "salon") {
    const { data: existing } = await supabase
      .from("sales")
      .select("id")
      .eq("user_id", user.id)
      .eq("period_label", period_label)
      .maybeSingle();

    if (!existing) {
      const monthlyCheck = await wouldExceedMonthlyLimit(supabase, user.id, "sales");
      if (monthlyCheck.exceeded) {
        return NextResponse.json(
          {
            error: limitReachedMessage(
              monthlyCheck,
              "manual sales entry",
              "this month",
              "manual sales entries",
            ),
            code: "FREE_LIMIT_REACHED",
          },
          { status: 403 },
        );
      }
    }
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
