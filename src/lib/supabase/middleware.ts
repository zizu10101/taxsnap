import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { EMPLOYEE_COOKIE, decideEmployeeAccess } from "@/lib/employee-route-guard";
import { lookupEmployeeSession } from "@/lib/employee-session";
import { CLIENT_COOKIE, decideClientAccess } from "@/lib/client-route-guard";
import { lookupClientSession } from "@/lib/client-session";
import { ACCOUNTANT_COOKIE, decideAccountantAccess } from "@/lib/accountant-route-guard";
import { lookupAccountantSession } from "@/lib/accountant-session";
import type { PortalGuardDecision } from "@/lib/portal-route-guard";

const PROTECTED_PREFIXES = ["/dashboard", "/billing", "/invoices"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: avoid writing logic between createServerClient and getUser().
  // A simple mistake could make it very hard to debug session refresh issues.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Cookie-session portals (employee, client, accountant): no Supabase user,
  // default-deny everything outside the portal's own prefixes. The decision
  // logic is shared (lib/portal-route-guard.ts); each portal supplies its
  // cookie, session lookup and wrapper. The DB lookup only runs for requests
  // that actually carry that cookie and have no owner session, so it costs the
  // rest of the app nothing. Portals are checked in order and the first with a
  // LIVE session decides the request - the login routes clear the other
  // portals' cookies, so two live sessions is a stale edge case, and denying
  // is the safe answer for it.
  const portals: {
    cookie: string;
    lookup: (raw: string) => Promise<unknown | null>;
    decide: (pathname: string, valid: boolean) => PortalGuardDecision;
    forbidMessage: string;
  }[] = [
    {
      cookie: EMPLOYEE_COOKIE,
      lookup: lookupEmployeeSession,
      decide: (pathname, valid) =>
        decideEmployeeAccess({
          pathname,
          hasEmployeeCookie: true,
          employeeSessionValid: valid,
          hasSupabaseUser: false,
        }),
      forbidMessage: "This session can only be used for clocking in and out.",
    },
    {
      cookie: CLIENT_COOKIE,
      lookup: lookupClientSession,
      decide: (pathname, valid) =>
        decideClientAccess({
          pathname,
          hasClientCookie: true,
          clientSessionValid: valid,
          hasSupabaseUser: false,
        }),
      forbidMessage: "This session can only be used to view your documents.",
    },
    {
      cookie: ACCOUNTANT_COOKIE,
      lookup: lookupAccountantSession,
      decide: (pathname, valid) =>
        decideAccountantAccess({
          pathname,
          hasAccountantCookie: true,
          accountantSessionValid: valid,
          hasSupabaseUser: false,
        }),
      forbidMessage: "This session has read-only access to your accountant reports.",
    },
  ];

  const deadPortalCookies: string[] = [];
  if (!user) {
    for (const portal of portals) {
      const raw = request.cookies.get(portal.cookie)?.value;
      if (!raw) continue;

      const valid = (await portal.lookup(raw)) !== null;
      const decision = portal.decide(path, valid);

      if (decision.action === "redirect") {
        return NextResponse.redirect(new URL(decision.to, request.url));
      }
      if (decision.action === "forbid") {
        return NextResponse.json({ error: portal.forbidMessage }, { status: 403 });
      }
      if (decision.action === "clear-cookie-and-pass") {
        deadPortalCookies.push(portal.cookie);
        supabaseResponse.cookies.delete(portal.cookie);
      } else if (valid) {
        // A live session already decided this request; later portals' cookies
        // are stale leftovers.
        break;
      }
    }
  }

  // The later redirects build a fresh response, so a dead portal cookie has to
  // be dropped on those too or it would linger (and trigger a DB lookup on
  // every request) until some request happened to pass through.
  const redirectTo = (url: URL) => {
    const response = NextResponse.redirect(url);
    for (const cookie of deadPortalCookies) response.cookies.delete(cookie);
    return response;
  };

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    path.startsWith(prefix),
  );

  if (!user && isProtected) {
    const redirectUrl = new URL("/auth", request.url);
    redirectUrl.searchParams.set("redirectTo", path);
    return redirectTo(redirectUrl);
  }

  if (user && path === "/auth") {
    return redirectTo(new URL("/dashboard", request.url));
  }

  // IMPORTANT: return the supabaseResponse object as-is so the refreshed
  // auth cookies propagate to the browser and back to the Supabase client.
  return supabaseResponse;
}
