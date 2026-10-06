import { NextResponse } from "next/server";
import { requireStatementUser } from "@/lib/statement-server";
import { dayNumber, isIsoDate } from "@/lib/statement-lines";
import { rankCandidates } from "@/lib/statement-matching";

export const runtime = "nodejs";

const DAY_MS = 86_400_000;
const PADDING_DAYS = 8;

// "Is this freshly scanned receipt the one a statement import already created an
// expense for?" Looks only at expenses still waiting for a receipt (no_receipt),
// using the same date + amount rules as the import matcher. Returned candidates
// are only ever offered to the user; nothing is attached here.
//
// If the receipts columns from migration 0053 aren't there yet the query fails;
// that is reported as "no candidates" so scanning a receipt keeps working.
export async function GET(request: Request) {
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  const { ctx } = auth;

  const url = new URL(request.url);
  const total = Number(url.searchParams.get("total"));
  const date = url.searchParams.get("date");
  if (!Number.isFinite(total) || total <= 0 || !isIsoDate(date)) {
    return NextResponse.json({ candidates: [] });
  }

  const center = dayNumber(date);
  const { data, error } = await ctx.supabase
    .from("receipts")
    .select("*")
    .eq("user_id", ctx.user.id)
    .eq("no_receipt", true)
    .gte("transaction_date", new Date((center - PADDING_DAYS) * DAY_MS).toISOString().slice(0, 10))
    .lte("transaction_date", new Date((center + PADDING_DAYS) * DAY_MS).toISOString().slice(0, 10));
  if (error) return NextResponse.json({ candidates: [], unavailable: true });

  const placeholders = (data ?? []).filter((r) => r.total_amount > 0);
  const ranked = rankCandidates(
    { id: "scan", date, amount: total },
    placeholders.map((r) => ({ id: r.id, date: r.transaction_date, amount: r.total_amount })),
  );
  const byId = new Map(placeholders.map((r) => [r.id, r]));

  return NextResponse.json({
    candidates: ranked.map((c) => {
      const r = byId.get(c.id)!;
      return {
        ...c,
        receipt: {
          id: r.id,
          merchant_name: r.merchant_name,
          transaction_date: r.transaction_date,
          total_amount: r.total_amount,
          tax_category: r.tax_category,
        },
      };
    }),
  });
}
