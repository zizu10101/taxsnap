import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { parseTimestamp, timeSessionErrorResponse } from "@/lib/time-session-errors";

// Owner closes a still-open session (e.g. a forgotten clock-out) with a
// corrected end time. Marked closed_by = 'owner' so it stays visibly
// distinguishable from a normal employee clock-out.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const clockOut = parseTimestamp(body?.clock_out_at);
  if (!clockOut) {
    return NextResponse.json({ error: "Enter a valid end time." }, { status: 400 });
  }

  const { data, error } = await result.supabase.rpc("owner_close_time_session", {
    p_id: id,
    p_clock_out_at: clockOut,
  });
  if (error) return timeSessionErrorResponse(error.message);
  return NextResponse.json({ session: data });
}
