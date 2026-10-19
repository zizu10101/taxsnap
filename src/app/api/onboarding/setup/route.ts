import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { CURRENCY, isProvinceCode } from "@/lib/onboarding";

// Onboarding step 1, province part (+ currency, CAD only). The business name,
// phone, address and BN number are saved through PATCH /api/profile/business -
// the same route Settings and the Invoices page use - so there is one place that
// writes them. Open to every plan. The tax rate is derived from the province
// (taxRateForProvince), never sent by the client.
export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json().catch(() => null);
  if (!isProvinceCode(body?.province)) {
    return NextResponse.json({ error: "Choose your province." }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ province: body.province, currency: CURRENCY })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
