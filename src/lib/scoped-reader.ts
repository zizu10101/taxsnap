import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// The one data door for the accountant portal. An accountant has no Supabase
// session, so the owner's row-level security can't scope them; instead every
// read goes through this reader, built from the verified session's user_id:
//
//   * only the tables below can be opened - anything else (clients, jobs'
//     contract changes, employee_pins, stylists/commission, billing, ...)
//     throws, so a future query can't quietly reach it;
//   * every read is filtered to this business with .eq("user_id", ...);
//   * there is no insert/update/delete/upsert/rpc - the object simply doesn't
//     have those methods, so a write can't happen even by mistake.
//
// Tables without their own user_id column (payments, document_items) are
// reachable only as embeds of an already-filtered parent (documents).
export const SCOPED_TABLES = [
  "receipts",
  "documents",
  "hour_entries",
  "jobs",
  "employees",
  "bank_accounts",
  "expense_categories",
] as const;

export type ScopedTable = (typeof SCOPED_TABLES)[number];

// The slice of a Supabase client the shared report/overview queries use. The
// owner's pages pass a real client (RLS scopes it); the accountant portal
// passes a scoped reader.
export type ReadDb = Pick<SupabaseClient<Database>, "from">;

export function createScopedReader(
  client: Pick<SupabaseClient<Database>, "from">,
  userId: string,
): ReadDb {
  const reader = {
    from(table: string) {
      if (!(SCOPED_TABLES as readonly string[]).includes(table)) {
        throw new Error(`The accountant portal can't read "${table}".`);
      }
      return {
        select: (...args: unknown[]) =>
          (client.from(table as ScopedTable) as unknown as {
            select: (...a: unknown[]) => { eq: (c: string, v: string) => unknown };
          })
            .select(...args)
            .eq("user_id", userId),
      };
    },
  };
  // Deliberately narrower than the real client at runtime (select only);
  // typed as ReadDb so the existing query functions accept it unchanged.
  return reader as unknown as ReadDb;
}
