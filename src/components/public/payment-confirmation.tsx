"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { PUBLIC_POLL_MAX_MS, PUBLIC_POLL_MS, confirmPhase } from "@/lib/online-payment-watch";

// Shown on /invoice/[token]?paid=1. The Stripe webhook can land a few seconds after the redirect,
// so while the invoice is not marked paid yet this re-reads the page every 2 s for up to 30 s.
// "Pay now" is hidden by the page for as long as this is waiting (see showPayNow).
export function PaymentConfirmation({ settled }: { settled: boolean }) {
  const router = useRouter();
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (settled) return;
    const timer = window.setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= PUBLIC_POLL_MAX_MS) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, PUBLIC_POLL_MS);
    return () => window.clearInterval(timer);
  }, [settled, startedAt, router]);

  const phase = confirmPhase({ justPaid: true, settled, elapsedMs: elapsed });
  const box = "rounded-lg border border-success/40 bg-success/10 p-4 text-center text-sm text-success";

  if (phase === "received") {
    return (
      <div className={box} role="status">
        Payment received. Thank you - a receipt is on its way to your email.
      </div>
    );
  }
  if (phase === "processing") {
    return (
      <div className={box} role="status">
        Your payment is being processed. You&apos;ll get a receipt by email.
      </div>
    );
  }
  return (
    <div className={`${box} flex items-center justify-center gap-2`} role="status">
      <Loader2 className="h-4 w-4 animate-spin" />
      Payment received, confirming...
    </div>
  );
}
