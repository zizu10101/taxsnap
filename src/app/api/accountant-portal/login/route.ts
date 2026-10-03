import { NextResponse } from "next/server";
import { generateOpaqueToken } from "@/lib/opaque-token";
import {
  ACCOUNTANT_COOKIE,
  ACCOUNTANT_LINK_COOKIE,
  ACCOUNTANT_SESSION_TTL_DAYS,
  createServiceClient,
  hashSessionToken,
} from "@/lib/accountant-session";
import { clearOtherPortalCookies } from "@/lib/portal-cookies";

// Per-IP throttle on top of verify_accountant_pin's own lockout: the lockout
// stops guessing the PIN, this caps how fast one source can try. Best-effort
// only (x-forwarded-for can be spoofed) - a speed bump, not the primary
// defense. The link token is 192 bits, so finding a link is already infeasible.
const IP_FAILURE_LIMIT = 20;
const IP_WINDOW_MINUTES = 15;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "unknown";
}

const GENERIC_FAIL = "Incorrect PIN.";

// Public, unauthenticated route. The business is resolved only from the link
// token, and every failure mode (bad link, no login, wrong PIN) returns the
// same message so it can't be used to probe which is true. Only a lockout is
// distinguishable, because the real accountant needs to know to ask the owner.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body?.token === "string" ? body.token : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";

  if (!/^\d{4}$/.test(pin) || !token) {
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 401 });
  }

  const supabase = createServiceClient();
  const ip = getClientIp(request);

  const since = new Date(Date.now() - IP_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count: recentFailures } = await supabase
    .from("accountant_login_failures")
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
    await supabase.from("accountant_login_failures").insert({ ip });
    // Opportunistic cleanup so the log can't grow forever.
    await supabase
      .from("accountant_login_failures")
      .delete()
      .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 401 });
  }

  const { data: login } = await supabase
    .from("accountant_logins")
    .select("user_id")
    .eq("link_token", token)
    .maybeSingle();
  if (!login) return fail();

  const { data: matched, error: verifyError } = await supabase.rpc("verify_accountant_pin", {
    p_user_id: login.user_id,
    p_pin: pin,
  });

  if (verifyError) {
    if (verifyError.message.includes("PIN_LOCKED")) {
      return NextResponse.json(
        {
          error: "Too many attempts. Ask the business owner to reset the PIN, or try again in 15 minutes.",
          code: "PIN_LOCKED",
        },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
  if (matched !== true) return fail();

  // Tidy up this business's expired sessions while we're here.
  await supabase
    .from("accountant_sessions")
    .delete()
    .eq("user_id", login.user_id)
    .lt("expires_at", new Date().toISOString());

  // FIXED lifetime: this is the only place expires_at is ever written.
  const rawToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + ACCOUNTANT_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { error: sessionError } = await supabase.from("accountant_sessions").insert({
    token_hash: hashSessionToken(rawToken),
    user_id: login.user_id,
    expires_at: expiresAt.toISOString(),
  });
  if (sessionError) {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(ACCOUNTANT_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  response.cookies.set(ACCOUNTANT_LINK_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  clearOtherPortalCookies(response, "accountant");
  return response;
}
