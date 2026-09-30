import { NextResponse } from "next/server";
import { logAdminAction } from "@/lib/admin-data";
import { prepareAdminAction } from "@/lib/admin-route";

// A note is just an admin_actions row of type 'note' (body in `reason`), so
// it shows up in /admin/log alongside everything else. The shared helper's
// required-`reason` check is what makes `reason` the note body here, with a
// longer cap than an action reason.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const prep = await prepareAdminAction(request, ctx.params, { maxReasonLength: 2000 });
  if (prep instanceof NextResponse) return prep;
  const { admin, profile, reason } = prep;

  const logError = await logAdminAction({
    accountId: profile.id,
    accountEmail: profile.email,
    adminId: admin.id,
    actionType: "note",
    reason,
  });
  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
