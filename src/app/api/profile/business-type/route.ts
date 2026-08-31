import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Answers the one-time "what kind of business is this?" prompt shown to a
// brand-new Google OAuth signup (/auth/choose-business-type) - not
// Pro-gated, since the prompt itself must be answerable regardless of
// subscription tier. Clears needs_business_type_prompt in the same update
// so the account is never asked again.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { business_type } = body ?? {};

  if (business_type !== "salon" && business_type !== "general") {
    return NextResponse.json(
      { error: "business_type must be 'salon' or 'general'." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ business_type, needs_business_type_prompt: false })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
