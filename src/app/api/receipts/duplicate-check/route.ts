import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findDuplicateChecks } from "@/lib/receipt-duplicates-server";

export const runtime = "nodejs";

// "Might this scan be one I already saved?" - the soft warning in the review dialog. Same cleaned
// merchant, same total to the cent, date within 2 days of an existing receipt (`similar`) - and a
// statement expense that ALREADY has a receipt attached, same vendor and amount within 30 days
// (`attached`), which saving this as new would count twice. A WARNING only: the
// answer never blocks anything, and the page lets the person save regardless. Any signed-in user
// (every tier); reads go through their own session, so RLS scopes them to their receipts.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const total = Number(url.searchParams.get("total"));
  const date = url.searchParams.get("date") ?? "";
  const merchant = (url.searchParams.get("merchant") ?? "").slice(0, 200);

  const { similar, attached } = await findDuplicateChecks(supabase, user.id, { merchant, total, date });
  return NextResponse.json({ similar, attached });
}
