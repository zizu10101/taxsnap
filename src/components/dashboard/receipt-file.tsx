"use client";

import { useState, useSyncExternalStore } from "react";
import { ExternalLink, FileText, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isPdfContentType, isPdfPath } from "@/lib/receipt-file";

// Wide enough that an embedded document viewer is usable. Phones (iOS Safari
// especially) render documents in an iframe badly or not at all, so below this
// the receipt opens through the "Open receipt" button instead.
const DESKTOP_QUERY = "(min-width: 1024px)";
function subscribeDesktop(callback: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}
const getDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
const getServerDesktop = () => false;

type Kind = "image" | "document" | "error";

// Shows one stored receipt from a signed URL, whatever kind of file it is: the
// person never picks a type. A photo renders as an image; a PDF renders in an
// embedded viewer on wide screens, with an "Open receipt" button on every
// screen. The kind comes from the stored path's extension, and if that gives no
// hint (or says "image" but the file turns out not to be one), the file's own
// content type decides before the error state shows.
//
// Callers key this by the receipt's path so it remounts per receipt.
export function ReceiptFile({
  url,
  path,
  className,
  imgClassName,
}: {
  url: string;
  path: string;
  className?: string;
  imgClassName?: string;
}) {
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktop, getServerDesktop);
  const [kind, setKind] = useState<Kind>(isPdfPath(path) ? "document" : "image");

  // Called when the <img> can't render it. createSignedUrl can resolve even
  // when the object is missing (seed/demo data), and a document uploaded with
  // an extension-less name looks like an image by path - so ask the file.
  async function handleImageError() {
    try {
      const res = await fetch(url, { method: "HEAD" });
      setKind(res.ok && isPdfContentType(res.headers.get("content-type")) ? "document" : "error");
    } catch {
      setKind("error");
    }
  }

  if (kind === "error") {
    return (
      <div className={className}>
        <div className="flex flex-col items-center gap-2 text-center">
          <ImageOff className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Couldn&apos;t load the original receipt</p>
        </div>
      </div>
    );
  }

  if (kind === "document") {
    return (
      <div className={className}>
        <div className="flex w-full flex-col items-center gap-3">
          {desktop && (
            <iframe
              src={url}
              title="Original receipt"
              className="h-[460px] w-full rounded-md border bg-background"
            />
          )}
          {!desktop && (
            <div className="flex flex-col items-center gap-2 text-center text-muted-foreground">
              <FileText className="h-8 w-8" />
              <p className="text-sm">This receipt is a document.</p>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={url} target="_blank" rel="noopener noreferrer" />}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open receipt
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Original receipt"
        className={imgClassName}
        onError={handleImageError}
      />
    </div>
  );
}
