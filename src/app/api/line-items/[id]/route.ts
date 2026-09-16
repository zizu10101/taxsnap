import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";

// No update route - a saved item is a lightweight reusable template with
// no downstream reference (document_items already snapshots its own
// description/unit_price at add time), so editing one is just delete +
// re-save rather than a full PATCH flow.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const { error } = await supabase
    .from("line_items")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
