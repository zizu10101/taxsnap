import * as Sentry from "@sentry/nextjs";
import { toSafeError } from "@/lib/sentry-privacy";

// Hand-written reports for failures a route catches and answers itself (so Next's own error hook
// never sees them). Server-only. Every function is a no-op when Sentry was not started (no DSN,
// or not the production deployment). What is sent: the route name, a Stripe event type/id and a
// pipeline stage as tags, plus the error's type, scrubbed message and stack. NEVER the request,
// its body, headers or any Stripe payload.

function active(): boolean {
  return Sentry.getClient() !== undefined;
}

// A serverless function can be frozen right after it answers, so wait (briefly) for the send.
async function send(): Promise<void> {
  try {
    await Sentry.flush(2000);
  } catch {
    // reporting must never break the request
  }
}

export async function captureRouteError(route: string, err: unknown, tags: Record<string, string> = {}): Promise<void> {
  if (!active()) return;
  Sentry.withScope((scope) => {
    scope.setTag("route", route);
    for (const [k, v] of Object.entries(tags)) scope.setTag(k, v);
    Sentry.captureException(toSafeError(err, route));
  });
  await send();
}

export type WebhookStage = "config" | "signature" | "processing";

// Every Stripe webhook failure. `eventType` / `eventId` are only known once the signature has
// verified; before that pass nothing and they are tagged "unverified" (the body is untrusted and
// is never read for this).
export async function captureStripeWebhookFailure(args: {
  route: string;
  stage: WebhookStage;
  err: unknown;
  eventType?: string;
  eventId?: string;
}): Promise<void> {
  if (!active()) return;
  Sentry.withScope((scope) => {
    scope.setTag("route", args.route);
    scope.setTag("stripe_webhook", "failed");
    scope.setTag("webhook_stage", args.stage);
    scope.setTag("stripe_event_type", args.eventType ?? "unverified");
    scope.setTag("stripe_event_id", args.eventId ?? "unverified");
    const code = (args.err as { code?: unknown } | null)?.code;
    if (typeof code === "string") scope.setTag("stripe_error_code", code);
    scope.setLevel("error");
    // A failed signature has nothing useful in its message beyond the stage; keep it fixed.
    const error =
      args.stage === "signature"
        ? new Error(`${args.route}: Stripe webhook signature check failed`)
        : toSafeError(args.err, args.route);
    Sentry.captureException(error);
  });
  await send();
}
