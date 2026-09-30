import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { assertAdmin } from "@/lib/require-admin";
import { createAdminClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export const MAX_REASON_LENGTH = 500;

// Shared front half of every /api/admin/accounts/[id]/* POST route: admin
// check, JSON body parse, required-reason validation, and target profile
// load. Returns a ready NextResponse on any failure so each route can just
// `if (prep instanceof NextResponse) return prep`.
export async function prepareAdminAction(
  request: Request,
  params: Promise<{ id: string }>,
  opts: { maxReasonLength?: number } = {},
): Promise<
  NextResponse | { admin: User; profile: Profile; body: Record<string, unknown>; reason: string }
> {
  const guard = await assertAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json({ error: "A reason is required." }, { status: 400 });
  }
  const max = opts.maxReasonLength ?? MAX_REASON_LENGTH;
  if (reason.length > max) {
    return NextResponse.json({ error: `Reason must be ${max} characters or fewer.` }, { status: 400 });
  }

  const { id } = await params;
  const { data: profile } = await createAdminClient()
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  return { admin: guard.user, profile, body, reason };
}

// Destructive Stripe actions additionally require the admin to have typed
// the account's email in the confirm dialog - re-checked here so the safety
// step can't be skipped by calling the route directly.
export function confirmEmailMatches(body: Record<string, unknown>, email: string) {
  return (
    typeof body.confirmEmail === "string" &&
    body.confirmEmail.trim().toLowerCase() === email.toLowerCase()
  );
}
