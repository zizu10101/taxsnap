import { NextResponse } from "next/server";
import { requireStatementUser, isUuid } from "@/lib/statement-server";
import { isIsoDate, round2 } from "@/lib/statement-lines";
import { attachDate } from "@/lib/statement-attach-period";
import type { ReceiptItem } from "@/lib/database.types";

export const runtime = "nodejs";

function sanitizeItems(items: unknown): ReceiptItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is ReceiptItem => !!item?.name?.trim())
    .map((item) => ({ name: item.name.trim(), amount: Number(item.amount) || 0 }));
}

// Attaches a scanned receipt to the expense a statement import already created
// for it, instead of inserting a second expense. The row keeps what the card
// statement is the authority on - the amount that actually left the card, the
// category the owner confirmed, "paid with" and the job - and takes what only the
// receipt knows: the photo, the HST, the items, and the merchant/date as printed.
//
// The update is conditional on no_receipt still being true, so two scans racing
// for one expense can't both attach: the loser gets a 409.
//
// Date: the receipt's date is used, UNLESS that moves the expense into a different
// calendar month (and so possibly quarter) - then `keep_statement_date` must say
// which date to keep (true = the statement's, false = the receipt's) and a request
// that doesn't is refused with DATE_CHOICE_REQUIRED. There is deliberately no
// default: it decides which HST period the expense lands in.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireStatementUser();
  if ("response" in auth) return auth.response;
  const { ctx } = auth;

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const { image_path, tax_amount, merchant_name, transaction_date, items, keep_statement_date } = body ?? {};

  // The photo was uploaded by /api/parse-receipt under `<user id>/...`; refuse a
  // path that points anywhere else, so one user can't attach another's file.
  if (
    typeof image_path !== "string" ||
    !image_path.startsWith(`${ctx.user.id}/`) ||
    image_path.includes("..")
  ) {
    return NextResponse.json({ error: "Invalid receipt image." }, { status: 400 });
  }
  if (typeof merchant_name !== "string" || !merchant_name.trim() || merchant_name.length > 200) {
    return NextResponse.json({ error: "merchant_name is required." }, { status: 400 });
  }
  if (!isIsoDate(transaction_date)) {
    return NextResponse.json({ error: "transaction_date is required." }, { status: 400 });
  }
  const tax = Number(tax_amount ?? 0);
  if (!Number.isFinite(tax) || tax < 0) {
    return NextResponse.json({ error: "Sales tax must be 0 or more." }, { status: 400 });
  }

  const { data: target } = await ctx.supabase
    .from("receipts")
    .select("*")
    .eq("id", id)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!target.no_receipt) {
    return NextResponse.json(
      { error: "That expense already has a receipt.", code: "ALREADY_ATTACHED" },
      { status: 409 },
    );
  }
  if (target.total_amount <= 0) {
    return NextResponse.json({ error: "A refund can't have a receipt attached." }, { status: 400 });
  }
  if (tax > target.total_amount) {
    return NextResponse.json({ error: "Sales tax can't be more than the total." }, { status: 400 });
  }

  const date = attachDate(
    target.transaction_date,
    transaction_date,
    typeof keep_statement_date === "boolean" ? keep_statement_date : undefined,
  );
  if (!date.ok) {
    return NextResponse.json(
      {
        error:
          date.code === "DATE_CHOICE_REQUIRED"
            ? "This moves the expense into a different month. Choose which date to keep."
            : "Invalid date.",
        code: date.code,
      },
      { status: date.code === "DATE_CHOICE_REQUIRED" ? 409 : 400 },
    );
  }

  const { data: updated, error } = await ctx.supabase
    .from("receipts")
    .update({
      image_url: image_path,
      tax_amount: round2(tax),
      merchant_name: merchant_name.trim(),
      transaction_date: date.date,
      items: sanitizeItems(items),
      no_receipt: false,
      receipt_attached_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", ctx.user.id)
    .eq("no_receipt", true)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Couldn't attach the receipt. Please try again." }, { status: 500 });
  if (!updated) {
    return NextResponse.json(
      { error: "That expense already has a receipt.", code: "ALREADY_ATTACHED" },
      { status: 409 },
    );
  }
  return NextResponse.json({ receipt: updated });
}
