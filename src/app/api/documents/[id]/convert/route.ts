import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { limitReachedMessage } from "@/lib/plan-limits";
import {
  convertEstimateToInvoice,
  EstimateNotFoundError,
  EstimateAlreadyConvertedError,
  MonthlyLimitExceededError,
} from "@/lib/estimate-conversion";

// Owner-initiated conversion (the "Convert to Invoice" button on the
// estimate detail page) - respects the monthly invoice cap (unlike the
// public sign flow's own call to the same shared function, which
// deliberately bypasses it). See lib/estimate-conversion.ts for the
// actual conversion logic, shared with POST /api/sign/[token].
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  try {
    const invoice = await convertEstimateToInvoice(supabase, id, user.id);
    return NextResponse.json({ document: invoice }, { status: 201 });
  } catch (err) {
    if (err instanceof EstimateNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof EstimateAlreadyConvertedError) {
      return NextResponse.json(
        { error: err.message, invoice_id: err.invoiceId },
        { status: 409 },
      );
    }
    if (err instanceof MonthlyLimitExceededError) {
      return NextResponse.json(
        {
          error: limitReachedMessage(err.check, "invoice", "this month"),
          code: "FREE_LIMIT_REACHED",
        },
        { status: 403 },
      );
    }
    const message = err instanceof Error ? err.message : "Failed to convert";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
