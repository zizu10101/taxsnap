import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { taxWritesFor, type TaxLineInput } from "./statement-tax.ts";
import { buildCategoryDefaults } from "./tax-codes.ts";

// Run just before commit_statement_import: puts every line that will become an expense onto its
// resolved tax code and calculated tax, so the SQL function (which only copies what the lines
// carry) saves exactly what the review screen showed. Reads through the owner's own session and
// writes with the service client (the owner has SELECT only on statement_lines), always filtered to
// this user and this import. Relative imports only, so the database test runs this exact code.
//
// Returns how many lines were written (0 when nothing differed, e.g. a retry after a failed
// commit).

type Db = SupabaseClient<Database>;

const COLUMNS =
  "id, kind, amount, category, original_currency, tax_amount, tax_rate, itc_pct, deductible_pct, tax_source, resolution";

export async function materializeStatementTaxes(
  reader: Db,
  admin: Db,
  userId: string,
  importId: string,
  bankChargesName: string | null,
): Promise<number> {
  const { data, error } = await reader
    .from("statement_lines")
    .select(COLUMNS)
    .eq("import_id", importId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  const lines = (data ?? []) as unknown as (TaxLineInput & { id: string; resolution: string | null })[];
  const writes = taxWritesFor(lines, buildCategoryDefaults({ bankChargesName }));
  for (const w of writes) {
    const { error: updateError } = await admin
      .from("statement_lines")
      .update(w.update)
      .eq("id", w.id)
      .eq("user_id", userId)
      .eq("import_id", importId);
    if (updateError) throw new Error(updateError.message);
  }
  return writes.length;
}
