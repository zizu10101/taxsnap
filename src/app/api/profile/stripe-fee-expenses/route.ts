import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The "Record Stripe fees as expenses automatically" switch (Settings > Online payments). Open to every
// plan, like the rest of Online payments. Changing it never touches an existing expense: it only decides
// whether the webhook creates one for the NEXT payment or dispute fee.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const enabled = body?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false." }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ record_stripe_fee_expenses: enabled })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, enabled });
}
