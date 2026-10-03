import { cookies } from "next/headers";
import { CLIENT_COOKIE } from "@/lib/client-route-guard";
import { createServiceClient, hashSessionToken } from "@/lib/employee-session";

export { CLIENT_COOKIE, createServiceClient, hashSessionToken };

// The client's own link token, remembered so a client whose session ended
// lands back on their own login page instead of a dead end. Grants nothing
// without the PIN.
export const CLIENT_LINK_COOKIE = "ts_client_link";

export const CLIENT_SESSION_TTL_DAYS = 30;
const TOUCH_AFTER_MS = 5 * 60 * 1000;

export type ClientSessionContext = {
  sessionId: string;
  // The owner whose documents these are, and the one client the session is
  // pinned to. Every portal query filters on BOTH, taken from here and never
  // from a request parameter.
  userId: string;
  clientId: string;
  clientName: string;
};

// Resolves a raw cookie value to a live session, or null if it's unknown,
// expired, or its client was removed. Deleting the login (or resetting the
// PIN / regenerating the link) deletes the session rows, so a revoked client
// is cut off on their next request. Slides the expiry forward, throttled.
export async function lookupClientSession(
  rawToken: string,
): Promise<ClientSessionContext | null> {
  if (!rawToken) return null;
  const supabase = createServiceClient();

  const { data } = await supabase
    .from("client_sessions")
    .select("id, user_id, client_id, last_seen_at, expires_at, client:clients(name)")
    .eq("token_hash", hashSessionToken(rawToken))
    .maybeSingle();

  if (!data) return null;
  const client = data.client as unknown as { name: string } | null;
  if (!client) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  if (Date.now() - new Date(data.last_seen_at).getTime() > TOUCH_AFTER_MS) {
    await supabase
      .from("client_sessions")
      .update({
        last_seen_at: new Date().toISOString(),
        expires_at: new Date(
          Date.now() + CLIENT_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString(),
      })
      .eq("id", data.id);
  }

  return {
    sessionId: data.id,
    userId: data.user_id,
    clientId: data.client_id,
    clientName: client.name,
  };
}

// Guard for every /api/client-portal/* handler (except login) and the
// /client/* pages. The proxy has already validated the cookie; this re-checks
// so a handler is safe on its own and no future route under the prefix can
// forget to authenticate.
export async function requireClientSession() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(CLIENT_COOKIE)?.value;
  const session = raw ? await lookupClientSession(raw) : null;
  if (!session) {
    return { error: "Your session has ended. Sign in again." as const, status: 401 as const };
  }
  return { session, supabase: createServiceClient() };
}
