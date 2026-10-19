import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";

export async function POST() {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { error } = await supabase
    .from("profiles")
    .update({ checklist_dismissed_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
