import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACCOUNTANT_COOKIE,
  ACCOUNTANT_LINK_COOKIE,
  createServiceClient,
  lookupAccountantSession,
} from "@/lib/accountant-session";
import { createScopedReader, type ReadDb } from "@/lib/scoped-reader";
import { loadAccountantBusiness } from "@/lib/accountant-portal-server";

export interface AccountantPageContext {
  userId: string;
  db: ReadDb;
  admin: ReturnType<typeof createServiceClient>;
  businessName: string | null;
  // false when the business has dropped below Pro: the portal then shows a
  // "not available" screen instead of any data.
  available: boolean;
}

// Shared by the /accountant layout and every page under it. Cached per
// request so the layout and the page don't each re-check the session. A
// missing/expired session goes back to the business's sign-in link if we
// remember it, otherwise to a plain signed-out page (see /accountant-login).
export const getAccountantPageContext = cache(async (): Promise<AccountantPageContext> => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ACCOUNTANT_COOKIE)?.value;
  const session = raw ? await lookupAccountantSession(raw) : null;

  if (!session) {
    const linkToken = cookieStore.get(ACCOUNTANT_LINK_COOKIE)?.value;
    redirect(linkToken ? `/accountant-login/${linkToken}` : "/accountant-login");
  }

  const admin = createServiceClient();
  const [{ data: profile }, { business }] = await Promise.all([
    admin.from("profiles").select("subscription_status").eq("id", session.userId).single(),
    loadAccountantBusiness(admin, session.userId),
  ]);

  return {
    userId: session.userId,
    db: createScopedReader(admin, session.userId),
    admin,
    businessName: business.name,
    available: profile?.subscription_status === "pro",
  };
});
