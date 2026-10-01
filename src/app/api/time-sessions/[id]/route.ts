import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { parseTimestamp, timeSessionErrorResponse } from "@/lib/time-session-errors";

// Deletes a clocked session together with its linked hours entry (done
// atomically in owner_delete_time_session - an entry without its session
// would be an orphan). Works on open sessions too (clocked in by mistake).
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;

  const { error } = await result.supabase.rpc("owner_delete_time_session", { p_id: id });
  if (error) return timeSessionErrorResponse(error.message);
  return NextResponse.json({ success: true });
}

// Owner edit of either timestamp, on an open or completed session.
// Body: { clock_in_at: ISO, clock_out_at: ISO | null }. A completed session
// must keep an end time; an open one must send clock_out_at: null (use
// POST .../close to end it).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const clockIn = parseTimestamp(body?.clock_in_at);
  const clockOut = body?.clock_out_at === null ? null : parseTimestamp(body?.clock_out_at);
  if (!clockIn || (body?.clock_out_at !== null && !clockOut)) {
    return NextResponse.json({ error: "Enter valid start and end times." }, { status: 400 });
  }

  const { data, error } = await result.supabase.rpc("owner_edit_time_session", {
    p_id: id,
    p_clock_in_at: clockIn,
    p_clock_out_at: clockOut,
  });
  if (error) return timeSessionErrorResponse(error.message);
  return NextResponse.json({ session: data });
}
