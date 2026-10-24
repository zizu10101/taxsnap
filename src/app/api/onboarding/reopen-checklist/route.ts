import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";

// Help -> "Reopen setup guide": clears the flag dismiss-checklist sets, so the dashboard's
// getting-started card shows again. Only the signed-in user's own profile row; not
// Pro-gated.
export async function POST() {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { error } = await supabase
    .from("profiles")
    .update({ checklist_dismissed_at: null })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
