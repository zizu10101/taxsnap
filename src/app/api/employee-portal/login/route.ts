import { NextResponse } from "next/server";
import { generateOpaqueToken } from "@/lib/opaque-token";
import {
  EMPLOYEE_COOKIE,
  EMPLOYEE_LINK_COOKIE,
  EMPLOYEE_SESSION_TTL_DAYS,
  createServiceClient,
  hashSessionToken,
} from "@/lib/employee-session";

// Per-IP throttle on top of verify_employee_pin's own per-employee lockout:
// the lockout stops guessing one employee's PIN, this stops one source
// sweeping every employee on the dropdown. Best-effort only - x-forwarded-for
// can be spoofed - so it's a speed bump, not the primary defense.
const IP_FAILURE_LIMIT = 20;
const IP_WINDOW_MINUTES = 15;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "unknown";
}

const GENERIC_FAIL = "Incorrect PIN.";

// Public, unauthenticated route - the business is resolved only from the
// shared link token, and every failure mode (bad token, unknown employee,
// no PIN set, wrong PIN) returns the same message so this can't be used to
// probe which of them is true. Only a lockout is distinguishable, because
// the real employee needs to know to ask the owner for a reset.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  const employeeId = typeof body?.employee_id === "string" ? body.employee_id : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";

  if (!/^\d{4}$/.test(pin) || !token || !employeeId) {
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 401 });
  }

  const supabase = createServiceClient();
  const ip = getClientIp(request);

  const since = new Date(Date.now() - IP_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count: recentFailures } = await supabase
    .from("employee_login_failures")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", since);
  if ((recentFailures ?? 0) >= IP_FAILURE_LIMIT) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  async function fail() {
    await supabase.from("employee_login_failures").insert({ ip });
    // Opportunistic cleanup so the log can't grow forever.
    await supabase
      .from("employee_login_failures")
      .delete()
      .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 401 });
  }

  const { data: settings } = await supabase
    .from("app_settings")
    .select("user_id")
    .eq("employee_login_token", token)
    .maybeSingle();
  if (!settings) return fail();

  const { data: matched, error: verifyError } = await supabase.rpc("verify_employee_pin", {
    p_user_id: settings.user_id,
    p_employee_id: employeeId,
    p_pin: pin,
  });

  if (verifyError) {
    if (verifyError.message.includes("PIN_LOCKED")) {
      return NextResponse.json(
        {
          error:
            "Too many attempts. Ask your employer to reset your PIN, or try again in 15 minutes.",
          code: "PIN_LOCKED",
        },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
  if (matched !== true) return fail();

  const rawToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + EMPLOYEE_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { error: sessionError } = await supabase.from("employee_sessions").insert({
    token_hash: hashSessionToken(rawToken),
    user_id: settings.user_id,
    employee_id: employeeId,
    expires_at: expiresAt.toISOString(),
  });
  if (sessionError) {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(EMPLOYEE_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  response.cookies.set(EMPLOYEE_LINK_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  return response;
}
