// Rules for the in-app "Send feedback" form. Pure, so the route and the dialog share one set of limits.
export const FEEDBACK_MESSAGE_MAX = 2000;
export const FEEDBACK_TRYING_TO_DO_MAX = 300;
export const FEEDBACK_PAGE_PATH_MAX = 200;

export type FeedbackInput = {
  message: string;
  tryingToDo: string | null;
  pagePath: string | null;
};

export type FeedbackResult = { ok: true; value: FeedbackInput } | { ok: false; error: string };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// A page path is only context, so a bad one is dropped rather than failing the whole submission.
function cleanPagePath(value: unknown): string | null {
  const path = text(value);
  if (!path.startsWith("/") || path.length > FEEDBACK_PAGE_PATH_MAX) return null;
  if (/[\u0000-\u001f\u007f]/.test(path)) return null;
  return path;
}

export function validateFeedback(body: unknown): FeedbackResult {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const message = text(raw.message);
  if (!message) return { ok: false, error: "Please write your feedback before sending." };
  if (message.length > FEEDBACK_MESSAGE_MAX) {
    return { ok: false, error: `Feedback can be up to ${FEEDBACK_MESSAGE_MAX} characters.` };
  }

  const tryingToDo = text(raw.tryingToDo);
  if (tryingToDo.length > FEEDBACK_TRYING_TO_DO_MAX) {
    return {
      ok: false,
      error: `"What were you trying to do?" can be up to ${FEEDBACK_TRYING_TO_DO_MAX} characters.`,
    };
  }

  return {
    ok: true,
    value: { message, tryingToDo: tryingToDo || null, pagePath: cleanPagePath(raw.pagePath) },
  };
}
