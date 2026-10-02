import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Client and job names are unique per account, case-insensitively and
// ignoring surrounding whitespace ("John" == "john " - backed by the
// lower(btrim(name)) unique indexes in 0046). ilike treats % and _ as
// wildcards, so they have to be escaped or "a_b" would match "axb".
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type NameTable = "clients" | "jobs" | "bank_accounts" | "expense_categories";

async function findByName(
  supabase: SupabaseClient<Database>,
  table: NameTable,
  userId: string,
  name: string,
  excludeId?: string,
) {
  let query = supabase
    .from(table)
    .select("*")
    .eq("user_id", userId)
    .ilike("name", escapeLike(name.trim()));
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query.limit(1).maybeSingle();
  return data;
}

export function findJobByName(
  supabase: SupabaseClient<Database>,
  userId: string,
  name: string,
  excludeId?: string,
) {
  return findByName(supabase, "jobs", userId, name, excludeId);
}

export function findClientByName(
  supabase: SupabaseClient<Database>,
  userId: string,
  name: string,
  excludeId?: string,
) {
  return findByName(supabase, "clients", userId, name, excludeId);
}

export function findBankAccountByName(
  supabase: SupabaseClient<Database>,
  userId: string,
  name: string,
  excludeId?: string,
) {
  return findByName(supabase, "bank_accounts", userId, name, excludeId);
}

export function findExpenseCategoryByName(
  supabase: SupabaseClient<Database>,
  userId: string,
  name: string,
  excludeId?: string,
) {
  return findByName(supabase, "expense_categories", userId, name, excludeId);
}

export function duplicateClientMessage(name: string) {
  return `A client named "${name.trim()}" already exists. Select them from the list instead.`;
}

export function duplicateJobMessage(name: string) {
  return `A job named "${name.trim()}" already exists.`;
}

// Postgres unique_violation - the race where two creates pass the
// pre-check at once and the unique index catches the loser.
export function isUniqueViolation(error: { code?: string } | null | undefined) {
  return error?.code === "23505";
}
