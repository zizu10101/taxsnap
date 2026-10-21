"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { OWNER_POLL_MS, awaitsPayment, shouldRefreshOwnerView, shouldWatchOnlinePayment } from "./online-payment-watch";

type Watched = Parameters<typeof shouldWatchOnlinePayment>[0];

// Keeps the owner's invoice page / list current after a client pays online: the webhook writes the
// payment on the server, so the page re-reads it (router.refresh).
//  - every 5 s while an online Checkout Session was opened in the last 30 minutes (fast),
//  - every 15 s for any other sent / partly paid invoice with a balance (the owner usually has the page open
//    BEFORE the client taps "Pay now", so the props can not say yet that a session exists),
//  - and immediately whenever the owner comes back to the tab / window (focus or visibilitychange).
// Only while the tab is visible; it stops by itself once nothing is awaiting payment, and the slow poll
// gives up 30 minutes after the page was last opened or returned to. (No realtime channel: the app has none.)
export function useOnlinePaymentWatch(documents: Watched[]) {
  const router = useRouter();
  // Time-free check while rendering; the clock-based rules run on every tick (shouldRefreshOwnerView).
  const watching = documents.some(awaitsPayment);
  // Survive re-renders: each router.refresh() hands down new props, which re-runs the effect.
  const armedAt = useRef(0);
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    if (!watching) return;
    if (armedAt.current === 0) armedAt.current = Date.now();
    const refresh = () => {
      lastRefreshAt.current = Date.now();
      router.refresh();
    };
    // Back on the tab: read now, and give the slow poll a fresh 30 minutes.
    const comeBack = () => {
      if (document.visibilityState !== "visible") return;
      armedAt.current = Date.now();
      refresh();
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (shouldRefreshOwnerView(documents, { now: Date.now(), armedAt: armedAt.current, lastRefreshAt: lastRefreshAt.current })) {
        refresh();
      }
    }, OWNER_POLL_MS);
    window.addEventListener("focus", comeBack);
    document.addEventListener("visibilitychange", comeBack);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", comeBack);
      document.removeEventListener("visibilitychange", comeBack);
    };
  }, [watching, documents, router]);
}
