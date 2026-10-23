"use client";

import { useEffect } from "react";
import NextError from "next/error";

// The last-resort boundary for an error in the root layout. It shows Next's own default error
// screen (so what a visitor sees is unchanged) and reports the error to Sentry when Sentry is on.
// Only the error object is sent, scrubbed in beforeSend - never page content.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
