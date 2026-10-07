import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleBulkTaxCode } from "@/lib/bulk-tax-code-server";

// Bulk "Set tax code" for the Expenses page (preview / apply / undo). All the rules live in
// lib/bulk-tax-code-server.ts so they can be tested as a real signed-in user; this only
// authenticates and forwards.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const result = await handleBulkTaxCode(supabase, user.id, body);
  return NextResponse.json(result.body, { status: result.status });
}
