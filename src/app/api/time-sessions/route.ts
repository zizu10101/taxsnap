import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";

// Owner view of clocked sessions (RLS scopes to the owner's own rows).
// ?open=true      only sessions still clocked in
// ?employee_id=   one employee
// ?limit=         default 50
export async function GET(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employee_id");
  const openOnly = searchParams.get("open") === "true";
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);

  let query = supabase
    .from("time_sessions")
    .select("*, job:jobs(id, name)")
    .order("clock_in_at", { ascending: false })
    .limit(limit);

  if (employeeId) query = query.eq("employee_id", employeeId);
  if (openOnly) query = query.is("clock_out_at", null);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data });
}
