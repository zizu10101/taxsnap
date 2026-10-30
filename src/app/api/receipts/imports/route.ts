import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleListImports } from "@/lib/bulk-delete-server";

// GET /api/receipts/imports - the recent CSV imports behind the Expenses page's "Imports" button: date,
// number of expenses and totals per import. The signed-in owner's rows only.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await handleListImports(supabase, user.id);
  return NextResponse.json(result.body, { status: result.status });
}
