"use client";

import { useEffect, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ReceiptFile } from "@/components/dashboard/receipt-file";

// Same keyed-remount signed-URL pattern as LogoImage
// (src/components/invoices/business-logo.tsx), pointed at the private
// "receipts" bucket instead of "logos". Callers key this by `path` so it
// re-fetches cleanly when shown for a different receipt.
// `className` sizes/positions the outer frame in every state; `imgClassName`
// styles the `<img>` itself once loaded (e.g. object-fit) so callers aren't
// forced to reuse frame layout classes as image styling.
//
// The file can be a photo or a PDF: ReceiptFile works out which, so this just
// signs the URL and hands it over.
export function ReceiptImage({
  path,
  className,
  imgClassName,
}: {
  path: string;
  className?: string;
  imgClassName?: string;
}) {
  const [state, setState] = useState<"loading" | "error" | string>("loading");

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.storage
      .from("receipts")
      .createSignedUrl(path, 60 * 60)
      .then(({ data, error }) => {
        if (cancelled) return;
        setState(!error && data ? data.signedUrl : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (state === "loading") {
    return (
      <div className={className}>
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className={className}>
        <div className="flex flex-col items-center gap-2 text-center">
          <ImageOff className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the original receipt</p>
        </div>
      </div>
    );
  }

  return <ReceiptFile url={state} path={path} className={className} imgClassName={imgClassName} />;
}
