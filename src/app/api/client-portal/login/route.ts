import { NextResponse } from "next/server";
import { generateOpaqueToken } from "@/lib/opaque-token";
import {
  CLIENT_COOKIE,
  CLIENT_LINK_COOKIE,
  CLIENT_SESSION_TTL_DAYS,
  createServiceClient,
  hashSessionToken,
} from "@/lib/client-session";
import { clearOtherPortalCookies } from "@/lib/portal-cookies";

// Per-IP throttle on top of verify_client_pin's own per-client lockout: the
// lockout stops guessing one client's PIN, this stops one source sweeping many
// links. Best-effort only (x-forwarded-for can be spoofed) - a speed bump, not
// the primary defense. A link token is 192 bits, so sweeping links is already
// infeasible; this mostly caps PIN guessing across a leaked link.
const IP_FAILURE_LIMIT = 20;
const IP_WINDOW_MINUTES = 15;

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "unknown";
}

const GENERIC_FAIL = "Incorrect PIN.";

// Public, unauthenticated route. The client is resolved only from the per-client
// link token, and every failure mode (bad link, no login, wrong PIN) returns the
// same message so it can't be used to probe which is true. Only a lockout is
// distinguishable, because the real client needs to know to contact the owner.
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
    .from("client_login_failures")
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
    await supabase.from("client_login_failures").insert({ ip });
    // Opportunistic cleanup so the log can't grow forever.
    await supabase
      .from("client_login_failures")
      .delete()
      .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    return NextResponse.json({ error: GENERIC_FAIL }, { status: 401 });
  }

  const { data: login } = await supabase
    .from("client_portal_logins")
    .select("client_id, user_id")
    .eq("link_token", token)
    .maybeSingle();
  if (!login) return fail();

  const { data: matched, error: verifyError } = await supabase.rpc("verify_client_pin", {
    p_user_id: login.user_id,
    p_client_id: login.client_id,
    p_pin: pin,
  });

  if (verifyError) {
    if (verifyError.message.includes("PIN_LOCKED")) {
      return NextResponse.json(
        {
          error:
            "Too many attempts. Ask your contractor to reset your PIN, or try again in 15 minutes.",
          code: "PIN_LOCKED",
        },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
  if (matched !== true) return fail();

  const rawToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + CLIENT_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const { error: sessionError } = await supabase.from("client_sessions").insert({
    token_hash: hashSessionToken(rawToken),
    user_id: login.user_id,
    client_id: login.client_id,
    expires_at: expiresAt.toISOString(),
  });
  if (sessionError) {
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(CLIENT_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  response.cookies.set(CLIENT_LINK_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  clearOtherPortalCookies(response, "client");
  return response;
}
