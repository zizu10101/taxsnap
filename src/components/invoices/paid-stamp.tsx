"use client";

import { useSyncExternalStore } from "react";
import { createPaidStampDataUrl } from "@/lib/invoice-pdf";

// Same canvas-drawn stamp graphic as the generated PDF (see
// createPaidStampDataUrl's own comment) - overlaid on the on-screen
// invoice detail view too, not just the download, so what an owner sees
// while looking at a paid invoice matches what a client receives.
//
// useSyncExternalStore, not useState+useEffect (this project's own
// convention for exactly this class of problem - see CLAUDE.md): canvas
// is a browser-only API, so an SSR pass - and the client's first
// hydration render, which has to match it - can't produce this image.
// getServerSnapshot's null is what both of those render, and the real
// value only appears once React swaps to getSnapshot right after
// hydration commits. There's nothing to actually subscribe to (the
// stamp never changes once generated), so subscribe() is a no-op -
// React's hydration-vs-client-snapshot reconciliation is what drives the
// one-time swap here, not a fired subscription callback.
//
// Cached at module scope rather than regenerated per mount: the
// jitter/speckle randomness in createPaidStampDataUrl means every call
// draws a slightly different stamp, and there's no reason two paid
// invoices open in the same session should look different from each
// other on screen (the downloaded PDF still gets its own fresh draw per
// download, independent of this).
let cachedDataUrl: string | null = null;

function getSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  if (!cachedDataUrl) cachedDataUrl = createPaidStampDataUrl();
  return cachedDataUrl;
}

function getServerSnapshot(): string | null {
  return null;
}

function subscribe(): () => void {
  return () => {};
}

export function PaidStamp({ className }: { className?: string }) {
  const dataUrl = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (!dataUrl) return null;

  // eslint-disable-next-line @next/next/no-img-element -- a generated data: URI, not an optimizable remote asset
  return <img src={dataUrl} alt="Paid" className={className} />;
}
