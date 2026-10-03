import { NextResponse } from "next/server";
import { requireAccountantSession } from "@/lib/accountant-session";
import { createScopedReader, type ReadDb } from "@/lib/scoped-reader";
import type { createServiceClient } from "@/lib/employee-session";

export interface AccountantApiContext {
  userId: string;
  // Select-only, scoped to the session's business. The only way route handlers
  // read data.
  db: ReadDb;
  // Raw service client, for storage signing and the business profile only.
  // Handlers must not read data tables through it.
  admin: ReturnType<typeof createServiceClient>;
}

// Every /api/accountant-portal/* handler (except login/logout) starts here:
// a verified session, a still-Pro business, and a scoped read-only reader.
export async function getAccountantApiContext(): Promise<
  { ctx: AccountantApiContext } | { response: NextResponse }
> {
  const access = await requireAccountantSession();
  if ("error" in access) {
    return { response: NextResponse.json({ error: access.error }, { status: access.status }) };
  }
  return {
    ctx: {
      userId: access.session.userId,
      db: createScopedReader(access.supabase, access.session.userId),
      admin: access.supabase,
    },
  };
}
