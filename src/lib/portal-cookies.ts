import type { NextResponse } from "next/server";
import { ACCOUNTANT_COOKIE } from "@/lib/accountant-route-guard";
import { CLIENT_COOKIE } from "@/lib/client-route-guard";
import { EMPLOYEE_COOKIE } from "@/lib/employee-route-guard";

type Portal = "employee" | "client" | "accountant";

const COOKIE_BY_PORTAL: Record<Portal, string> = {
  employee: EMPLOYEE_COOKIE,
  client: CLIENT_COOKIE,
  accountant: ACCOUNTANT_COOKIE,
};

// One portal identity per browser: signing in to one portal drops any session
// for the other two, so their route guards never disagree about who this is.
export function clearOtherPortalCookies(response: NextResponse, keep: Portal): void {
  for (const portal of Object.keys(COOKIE_BY_PORTAL) as Portal[]) {
    if (portal !== keep) response.cookies.delete(COOKIE_BY_PORTAL[portal]);
  }
}
