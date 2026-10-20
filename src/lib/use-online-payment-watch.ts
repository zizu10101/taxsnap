"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { OWNER_POLL_MS, mayWatchOnlinePayment, shouldWatchOnlinePayment } from "./online-payment-watch";

type Watched = Parameters<typeof shouldWatchOnlinePayment>[0];

// Keeps the owner's invoice page / list current after a client pays online: the webhook writes the
// payment on the server, so the page re-reads it (router.refresh) every 5 s - only while some
// invoice had an online session opened in the last 30 minutes and still owes a balance - and once
// more whenever the window regains focus. It stops by itself when every invoice is paid or the
// window is over. (No realtime channel: the app does not use one.)
export function useOnlinePaymentWatch(documents: Watched[]) {
  const router = useRouter();
  // Time-free check while rendering; the 30-minute window itself is checked on every tick.
  const watching = documents.some(mayWatchOnlinePayment);

  useEffect(() => {
    if (!watching) return;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    // The window can run out between renders; re-check on each tick via the same rule.
    const timer = window.setInterval(() => {
      if (!documents.some((d) => shouldWatchOnlinePayment(d, Date.now()))) {
        window.clearInterval(timer);
        return;
      }
      tick();
    }, OWNER_POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [watching, documents, router]);
}
