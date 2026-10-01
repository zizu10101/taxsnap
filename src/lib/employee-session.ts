import { createHash } from "crypto";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { EMPLOYEE_COOKIE } from "@/lib/employee-route-guard";

export { EMPLOYEE_COOKIE };

// The shared login link's token, remembered so an employee whose session
// ended lands back on their own business's login page instead of a dead end.
// Not a secret (every employee already has the link) and grants nothing.
export const EMPLOYEE_LINK_COOKIE = "ts_emp_link";

export const EMPLOYEE_SESSION_TTL_DAYS = 30;
const TOUCH_AFTER_MS = 5 * 60 * 1000;

export type EmployeeSessionContext = {
  sessionId: string;
  userId: string;
  employeeId: string;
  employeeName: string;
};

// Service-role client with no cookie/session handling. Used by the proxy
// (which can't use next/headers' cookies() the way route handlers do) and by
// every employee-portal route - employees never get a Supabase JWT, so RLS
// can't scope them; these server-side lookups, keyed off the verified session
// row, are the whole boundary.
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function hashSessionToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Resolves a raw cookie value to a live session, or null if it's unknown,
// expired, or its employee was deactivated/removed. Slides the expiry
// forward (throttled, so it isn't a write on every request).
export async function lookupEmployeeSession(
  rawToken: string,
): Promise<EmployeeSessionContext | null> {
  if (!rawToken) return null;
  const supabase = createServiceClient();

  const { data } = await supabase
    .from("employee_sessions")
    .select("id, user_id, employee_id, last_seen_at, expires_at, employee:employees(name, is_active)")
    .eq("token_hash", hashSessionToken(rawToken))
    .maybeSingle();

  if (!data) return null;
  const employee = data.employee as unknown as { name: string; is_active: boolean } | null;
  if (!employee || !employee.is_active) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  if (Date.now() - new Date(data.last_seen_at).getTime() > TOUCH_AFTER_MS) {
    await supabase
      .from("employee_sessions")
      .update({
        last_seen_at: new Date().toISOString(),
        expires_at: new Date(
          Date.now() + EMPLOYEE_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString(),
      })
      .eq("id", data.id);
  }

  return {
    sessionId: data.id,
    userId: data.user_id,
    employeeId: data.employee_id,
    employeeName: employee.name,
  };
}

// Guard for every /api/employee-portal/* handler (except login) and the
// /employee/* pages. The proxy has already validated the cookie before the
// request got here; this re-checks so a handler is safe on its own and no
// future route under the prefix can forget to authenticate.
export async function requireEmployeeSession() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(EMPLOYEE_COOKIE)?.value;
  const session = raw ? await lookupEmployeeSession(raw) : null;
  if (!session) {
    return { error: "Your session has ended. Sign in again." as const, status: 401 as const };
  }
  return { session, supabase: createServiceClient() };
}
