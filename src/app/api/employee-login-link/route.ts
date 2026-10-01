import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { createServiceClient } from "@/lib/employee-session";
import { generateOpaqueToken } from "@/lib/opaque-token";

// The one shared, reusable per-business employee login link. app_settings has
// no insert/update RLS policy (PINs/token only change through controlled
// paths), so writes go through the service client after requireUser() has
// established who the owner is - the user id always comes from the session,
// never the body.
//
// POST                    -> returns the existing token, creating it on first use
// POST { regenerate:true } -> replaces it (old link dies) and ends every
//                            employee session for this business
export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { user } = result;
  const body = await request.json().catch(() => ({}));
  const regenerate = body?.regenerate === true;

  const admin = createServiceClient();

  await admin
    .from("app_settings")
    .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });

  if (regenerate) {
    const { error } = await admin
      .from("app_settings")
      .update({ employee_login_token: generateOpaqueToken() })
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("employee_sessions").delete().eq("user_id", user.id);
  } else {
    // Only fills a null token - two simultaneous first-time calls can't
    // overwrite each other's link.
    await admin
      .from("app_settings")
      .update({ employee_login_token: generateOpaqueToken() })
      .eq("user_id", user.id)
      .is("employee_login_token", null);
  }

  const { data, error } = await admin
    .from("app_settings")
    .select("employee_login_token")
    .eq("user_id", user.id)
    .single();
  if (error || !data.employee_login_token) {
    return NextResponse.json({ error: "Couldn't create the login link." }, { status: 500 });
  }

  return NextResponse.json({ token: data.employee_login_token });
}
