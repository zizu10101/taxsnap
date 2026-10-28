import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { validateFeedback } from "@/lib/feedback";
import { allowFeedback, refundFeedback } from "@/lib/feedback-rate-limit";
import { sendFeedbackEmail } from "@/lib/email";
import { SUPPORT_EMAIL } from "@/lib/support";

// Feedback goes to support by email and is stored nowhere. The message is never logged.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { user } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const result = validateFeedback(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (!allowFeedback(user.id)) {
    return NextResponse.json(
      { error: "You have sent a few messages already. Please try again in a while." },
      { status: 429 },
    );
  }

  const sent = await sendFeedbackEmail({
    to: SUPPORT_EMAIL,
    replyTo: user.email ?? null,
    ...result.value,
    userId: user.id,
    userEmail: user.email ?? null,
    sentAt: new Date(),
  });
  if (!sent) {
    refundFeedback(user.id);
    return NextResponse.json(
      { error: "Could not send your feedback. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
