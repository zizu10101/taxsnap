import { round2 } from "./statement-lines.ts";

// The statement-total check on the review screen: do the extracted lines add up
// to what the statement itself says? It always runs over every extracted line
// (whatever the user later skips or edits the category of), because it tests
// how faithfully the lines were read, not what the user chose to import.
//
//  1. Balance roll (strongest, covers every kind of line): closing - opening
//     must equal the signed sum of all lines (charges +, payments/credits -).
//  2. Purchases total: when only a "total purchases" figure is printed, it must
//     equal the sum of the purchase-type lines. Fees, interest, refunds and
//     payments are listed separately on a statement, so they're not in it.
//  3. Otherwise there is nothing to check against.
//
// Money is compared in whole cents so 0.1 + 0.2 style float noise can't flag a
// correct statement.

export interface ReconcileLine {
  amount: number;
  kind: string;
}

export interface ReconcileInput {
  lines: ReconcileLine[];
  opening_balance: number | null;
  closing_balance: number | null;
  statement_total: number | null;
  statement_total_kind: "purchases" | "new_balance" | null;
}

export type ReconcileResult =
  | { status: "no_total" }
  | {
      status: "matches" | "off";
      basis: "balance_roll" | "purchases";
      /** What the statement says. */
      expected: number;
      /** What the extracted lines add up to. */
      extracted: number;
      /** extracted - expected (0 when it matches). */
      diff: number;
    };

function cents(n: number): number {
  return Math.round(n * 100);
}

export function reconcileStatement(input: ReconcileInput): ReconcileResult {
  const { lines } = input;

  if (input.opening_balance !== null && input.closing_balance !== null) {
    const extractedCents = lines.reduce((sum, l) => sum + cents(l.amount), 0);
    const expectedCents = cents(input.closing_balance) - cents(input.opening_balance);
    return finish("balance_roll", expectedCents, extractedCents);
  }

  if (input.statement_total_kind === "purchases" && input.statement_total !== null) {
    const extractedCents = lines
      .filter((l) => l.kind === "purchase")
      .reduce((sum, l) => sum + cents(l.amount), 0);
    return finish("purchases", cents(input.statement_total), extractedCents);
  }

  return { status: "no_total" };
}

function finish(
  basis: "balance_roll" | "purchases",
  expectedCents: number,
  extractedCents: number,
): ReconcileResult {
  const diffCents = extractedCents - expectedCents;
  return {
    status: diffCents === 0 ? "matches" : "off",
    basis,
    expected: round2(expectedCents / 100),
    extracted: round2(extractedCents / 100),
    diff: round2(diffCents / 100),
  };
}
