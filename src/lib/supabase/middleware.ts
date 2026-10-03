import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { EMPLOYEE_COOKIE, decideEmployeeAccess } from "@/lib/employee-route-guard";
import { lookupEmployeeSession } from "@/lib/employee-session";
import { CLIENT_COOKIE, decideClientAccess } from "@/lib/client-route-guard";
import { lookupClientSession } from "@/lib/client-session";

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

  // Employee-portal sessions (no Supabase user): default-deny everything
  // outside the employee prefixes. See lib/employee-route-guard.ts. The DB
  // lookup only runs for requests that actually carry the employee cookie
  // and have no owner session, so it costs the rest of the app nothing.
  const employeeCookie = request.cookies.get(EMPLOYEE_COOKIE)?.value;
  let clearEmployeeCookie = false;
  let employeeSessionActive = false;
  if (!user && employeeCookie) {
    const session = await lookupEmployeeSession(employeeCookie);
    employeeSessionActive = session !== null;
    const decision = decideEmployeeAccess({
      pathname: path,
      hasEmployeeCookie: true,
      employeeSessionValid: session !== null,
      hasSupabaseUser: false,
    });

    if (decision.action === "redirect") {
      return NextResponse.redirect(new URL(decision.to, request.url));
    }
    if (decision.action === "forbid") {
      return NextResponse.json(
        { error: "This session can only be used for clocking in and out." },
        { status: 403 },
      );
    }
    if (decision.action === "clear-cookie-and-pass") {
      clearEmployeeCookie = true;
      supabaseResponse.cookies.delete(EMPLOYEE_COOKIE);
    }
  }

  // Client-portal sessions: same default-deny, outside /client/**. Skipped
  // when a live employee session already decided this request (the login
  // routes clear the other cookie, so both being live is a stale edge case,
  // and the employee guard's deny is the safe answer for it).
  const clientCookie = request.cookies.get(CLIENT_COOKIE)?.value;
  let clearClientCookie = false;
  if (!user && clientCookie && !employeeSessionActive) {
    const session = await lookupClientSession(clientCookie);
    const decision = decideClientAccess({
      pathname: path,
      hasClientCookie: true,
      clientSessionValid: session !== null,
      hasSupabaseUser: false,
    });

    if (decision.action === "redirect") {
      return NextResponse.redirect(new URL(decision.to, request.url));
    }
    if (decision.action === "forbid") {
      return NextResponse.json(
        { error: "This session can only be used to view your documents." },
        { status: 403 },
      );
    }
    if (decision.action === "clear-cookie-and-pass") {
      clearClientCookie = true;
      supabaseResponse.cookies.delete(CLIENT_COOKIE);
    }
  }

  // The later redirects build a fresh response, so a dead employee/client
  // cookie has to be dropped on those too or it would linger (and trigger a
  // DB lookup on every request) until some request happened to pass through.
  const redirectTo = (url: URL) => {
    const response = NextResponse.redirect(url);
    if (clearEmployeeCookie) response.cookies.delete(EMPLOYEE_COOKIE);
    if (clearClientCookie) response.cookies.delete(CLIENT_COOKIE);
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
