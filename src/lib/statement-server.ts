import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isStatementImportEnabled } from "@/lib/statement-config";
import { PLAN_LIMITS } from "@/lib/plan-limits";
import {
  bankChargesSuggestion,
  resolveBankCharges,
  statementCategoryOptions,
} from "@/lib/statement-categories";
import { loadCategoryRows } from "@/lib/statement-bank-charges";
import type { Database, StatementImport, SubscriptionStatus } from "@/lib/database.types";

// Shared plumbing for every /api/statements route.
//
// Two clients on purpose:
//  - `supabase` is the caller's own session: every READ goes through it, so RLS
//    (owner-select-only on the three statement tables) is what scopes the data.
//  - `admin` is the service role: every WRITE goes through it - the statement
//    tables and functions accept no other writer (0052). It is only ever handed
//    `user.id` from the verified session, never an id from a request body.

export interface StatementCtx {
  supabase: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
  user: User;
}

// 401 when signed out; 404 (not 403) when the user isn't on the allowlist, so
// the feature's existence isn't revealed to anyone it's off for.
export async function requireStatementUser(): Promise<{ ctx: StatementCtx } | { response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!isStatementImportEnabled(user.id)) {
    return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { ctx: { supabase, admin: createAdminClient(), user } };
}

// The same context for a server-rendered page: null when signed out or when the
// user isn't on the allowlist (the caller redirects / calls notFound()).
export async function getStatementPageCtx(): Promise<StatementCtx | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isStatementImportEnabled(user.id)) return null;
  return { supabase, admin: createAdminClient(), user };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

// An import by id, read through the caller's session (RLS) and re-filtered on
// user_id - belt and braces, so a policy mistake could never widen this.
export async function loadOwnImport(ctx: StatementCtx, id: string): Promise<StatementImport | null> {
  if (!isUuid(id)) return null;
  const { data } = await ctx.supabase
    .from("statement_imports")
    .select("*")
    .eq("id", id)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  return data ?? null;
}

// What a statement line can be filed under, and where interest and fees go (see
// statement-categories.ts: the bank-charges category is found by a stable key, so it
// can be renamed or removed in Settings).
export async function loadCategoryContext(
  ctx: StatementCtx,
): Promise<{ options: string[]; bankChargesCategory: string | null }> {
  const rows = await loadCategoryRows(ctx.supabase, ctx.user.id);
  return {
    options: statementCategoryOptions(rows),
    bankChargesCategory: bankChargesSuggestion(resolveBankCharges(rows)),
  };
}

// Built-ins + the owner's active custom categories (+ the bank-charges default if it doesn't exist yet).
export async function loadCategoryOptions(ctx: StatementCtx): Promise<string[]> {
  return (await loadCategoryContext(ctx)).options;
}

// This user's monthly import cap from their plan (null = unlimited).
export async function monthlyCapFor(ctx: StatementCtx): Promise<number | null> {
  const { data: profile } = await ctx.supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", ctx.user.id)
    .single();
  const tier: SubscriptionStatus = profile?.subscription_status ?? "free";
  return PLAN_LIMITS[tier].statementImportsPerMonth;
}
