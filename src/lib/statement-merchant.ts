import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { cleanMerchantName } from "./merchant-name.ts";

// The commit function saves each new expense under the statement line's raw
// description ("ROGERS *************3771"). This tidies that to a merchant name
// ("Rogers") on just the expenses that commit created. The statement line keeps
// its original description untouched, so nothing is lost.
//
// It runs after the commit and is best-effort: if it fails the expenses simply
// keep the raw description (still correct, just untidy), so it never fails the
// save. Each update only applies while the name is still exactly what commit
// wrote, so a name the user edited in the meantime is never overwritten.
//
// `supabase` is the caller's own session in the app (RLS scopes both queries);
// both are also filtered on user_id explicitly. Relative imports only, so the
// database test can run this exact code.
export async function tidyMerchantNames(
  ctx: { supabase: SupabaseClient<Database>; user: { id: string } },
  importId: string,
): Promise<number> {
  const { data: rows } = await ctx.supabase
    .from("statement_lines")
    .select("description, created_receipt_id")
    .eq("import_id", importId)
    .eq("user_id", ctx.user.id)
    .not("created_receipt_id", "is", null);

  const todo = (rows ?? []).flatMap((r) => {
    const raw = r.description.trim().slice(0, 200);
    const clean = cleanMerchantName(r.description);
    return r.created_receipt_id && clean && clean !== raw
      ? [{ id: r.created_receipt_id, raw, clean }]
      : [];
  });

  let changed = 0;
  for (let i = 0; i < todo.length; i += 20) {
    const results = await Promise.all(
      todo.slice(i, i + 20).map((t) =>
        ctx.supabase
          .from("receipts")
          .update({ merchant_name: t.clean })
          .eq("id", t.id)
          .eq("user_id", ctx.user.id)
          .eq("merchant_name", t.raw)
          .select("id"),
      ),
    );
    for (const res of results) {
      if (res.error) console.error("[statements] merchant tidy failed", { code: res.error.code });
      else changed += res.data?.length ?? 0;
    }
  }
  return changed;
}
