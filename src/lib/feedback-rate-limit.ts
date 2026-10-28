// Per-user limit for feedback sends. In memory on purpose (no table, no migration): on serverless each
// instance counts separately, so this is a brake on a runaway client, not an exact quota.
export const FEEDBACK_LIMIT = 5;
export const FEEDBACK_WINDOW_MS = 60 * 60 * 1000;

const sent = new Map<string, number[]>();

/** Records an attempt and returns true if it is allowed, false if the user is over the limit. */
export function allowFeedback(userId: string, now: number = Date.now()): boolean {
  const recent = (sent.get(userId) ?? []).filter((t) => now - t < FEEDBACK_WINDOW_MS);
  if (recent.length >= FEEDBACK_LIMIT) {
    sent.set(userId, recent);
    return false;
  }
  recent.push(now);
  sent.set(userId, recent);
  return true;
}

/** Gives back the slot of an attempt that never reached us (the email failed). */
export function refundFeedback(userId: string): void {
  const list = sent.get(userId);
  if (list) list.pop();
}

export function resetFeedbackLimits(): void {
  sent.clear();
}
