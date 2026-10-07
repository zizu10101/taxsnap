// Where saved card statements live in the app. Every link to the Statements list, a statement or an
// expense goes through here, so when the Bank tab arrives the list and detail can move by changing
// this one file (and re-exporting the two pages) - nothing else hardcodes these paths.

export const STATEMENTS_HREF = "/dashboard/expenses/statements";
export const STATEMENTS_DELETED_HREF = `${STATEMENTS_HREF}?deleted=1`;

export const statementHref = (importId: string) => `${STATEMENTS_HREF}/${importId}`;

// An expense, opened in the Expenses drawer (the existing ?receipt= deep link).
export const expenseHref = (receiptId: string) => `/dashboard/expenses?receipt=${encodeURIComponent(receiptId)}`;
