import { cookies } from "next/headers";
import { ACCOUNTANT_COOKIE, ACCOUNTANT_SESSION_TTL_DAYS } from "@/lib/accountant-route-guard";
import { createServiceClient, hashSessionToken } from "@/lib/employee-session";

export { ACCOUNTANT_COOKIE, ACCOUNTANT_SESSION_TTL_DAYS, createServiceClient, hashSessionToken };

// The business's accountant link token, remembered so an accountant whose
// session ended lands back on the sign-in page instead of a dead end. Grants
// nothing without the PIN.
export const ACCOUNTANT_LINK_COOKIE = "ts_accountant_link";

export type AccountantSessionContext = {
  sessionId: string;
  // The business whose records this session reads. Every portal query is
  // scoped to this id, taken from the verified session row and never from a
  // request parameter.
  userId: string;
};

// Resolves a raw cookie value to a live session, or null if it's unknown or
// expired. FIXED lifetime: expires_at is set once at sign-in (14 days) and is
// never extended, and the cookie expires with it. There is deliberately no
// sliding-expiry write here. Resetting the PIN, regenerating the link or
// removing the login deletes the session rows, cutting access on the next
// request.
export async function lookupAccountantSession(
  rawToken: string,
): Promise<AccountantSessionContext | null> {
  if (!rawToken) return null;
  const supabase = createServiceClient();

  const { data } = await supabase
    .from("accountant_sessions")
    .select("id, user_id, expires_at")
    .eq("token_hash", hashSessionToken(rawToken))
    .maybeSingle();

  if (!data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  return { sessionId: data.id, userId: data.user_id };
}

export type AccountantAccess =
  | { session: AccountantSessionContext; supabase: ReturnType<typeof createServiceClient> }
  | { error: string; status: 401 | 403 };

// Guard for every /api/accountant-portal/* handler (except login) and the
// /accountant/* pages. The proxy has already validated the cookie; this
// re-checks so a handler is safe on its own, and also confirms the business is
// still on Pro (Reports is a Pro feature) - a downgrade closes the portal
// without deleting the login, and it reopens on re-upgrade.
export async function requireAccountantSession(): Promise<AccountantAccess> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ACCOUNTANT_COOKIE)?.value;
  const session = raw ? await lookupAccountantSession(raw) : null;
  if (!session) {
    return { error: "Your session has ended. Sign in again.", status: 401 };
  }

  const supabase = createServiceClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", session.userId)
    .single();
  if (profile?.subscription_status !== "pro") {
    return { error: "Accountant access isn't available for this account right now.", status: 403 };
  }

  return { session, supabase };
}
