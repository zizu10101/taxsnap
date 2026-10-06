// Maps a Postgres error raised by the statement functions (0052) to an HTTP
// status, a stable code the UI can switch on, and a user-safe message. The
// raw database text never reaches the client. Pure, so it unit-tests directly.

export interface StatementApiError {
  status: number;
  code: string;
  message: string;
}

const BY_MESSAGE: Record<string, StatementApiError> = {
  ACCOUNT_NOT_CARD: { status: 400, code: "ACCOUNT_NOT_CARD", message: "Choose one of your credit cards." },
  ALREADY_IMPORTED: {
    status: 409,
    code: "ALREADY_IMPORTED",
    message: "This statement file was already imported.",
  },
  STATEMENT_CAP_REACHED: {
    status: 403,
    code: "STATEMENT_CAP_REACHED",
    message: "You've used all your statement imports for this month.",
  },
  IMPORT_NOT_OPEN: { status: 409, code: "IMPORT_NOT_OPEN", message: "This import is no longer open." },
  CHUNK_NOT_FOUND: { status: 404, code: "CHUNK_NOT_FOUND", message: "That part of the statement wasn't found." },
  CHUNKS_INCOMPLETE: {
    status: 409,
    code: "CHUNKS_INCOMPLETE",
    message: "Some pages haven't been read yet. Retry them first.",
  },
  NOT_FINALIZED: { status: 409, code: "NOT_FINALIZED", message: "This import isn't ready to save yet." },
  RECONCILE_NOT_ACKNOWLEDGED: {
    status: 409,
    code: "RECONCILE_NOT_ACKNOWLEDGED",
    message: "The lines don't match the statement's total. Confirm that you've checked it before saving.",
  },
  UNDECIDED_LINES: {
    status: 409,
    code: "UNDECIDED_LINES",
    message: "Some lines still need a decision.",
  },
  UNCONFIRMED_CATEGORIES: {
    status: 409,
    code: "UNCONFIRMED_CATEGORIES",
    message: "Some categories are still suggestions. Accept or change them first.",
  },
  DUPLICATE_LINES: {
    status: 409,
    code: "DUPLICATE_LINES",
    message: "Some lines were already imported. Skip them, or choose Import anyway.",
  },
  BAD_RECEIPT_CLAIM: {
    status: 409,
    code: "BAD_RECEIPT_CLAIM",
    message: "A receipt you matched is no longer available. Review the matches again.",
  },
};

export function mapStatementDbError(error: { message?: string | null; code?: string | null } | null | undefined): StatementApiError {
  const message = (error?.message ?? "").trim();
  for (const key of Object.keys(BY_MESSAGE)) {
    if (message === key || message.includes(key)) return BY_MESSAGE[key];
  }
  if (error?.code === "23505") {
    return {
      status: 409,
      code: "CLAIM_CONFLICT",
      message: "That receipt is already matched to another statement line.",
    };
  }
  if (error?.code === "23514") {
    return {
      status: 400,
      code: "INVALID_LINE",
      message: "That change isn't valid for this line (for example, a refund must be a negative amount).",
    };
  }
  return { status: 500, code: "DB_ERROR", message: "Something went wrong saving that. Please try again." };
}
