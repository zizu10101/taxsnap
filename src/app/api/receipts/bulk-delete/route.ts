import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleBulkDelete } from "@/lib/bulk-delete-server";

// Bulk delete for the Expenses page, and "Delete this import" (preview / apply). All the rules live in
// lib/bulk-delete-server.ts so they can be tested; this only authenticates and forwards.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const result = await handleBulkDelete(supabase, user.id, body);
  return NextResponse.json(result.body, { status: result.status });
}
