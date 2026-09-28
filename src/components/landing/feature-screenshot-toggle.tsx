"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PhoneMockup } from "@/components/landing/phone-mockup";
import { BrowserMockup } from "@/components/landing/browser-mockup";

type View = "mobile" | "desktop";

// A plain dashed placeholder for a page that doesn't have a real
// screenshot yet (e.g. a brand-new feature page) - PhoneMockup/
// BrowserMockup both expect a pre-composed asset (PhoneMockup especially:
// a real device photo with the screenshot baked into its screen area),
// so there's no way to "fake" either mockup shape without one. Same box
// for both tabs so the placeholder state looks consistent regardless of
// which one's missing, rather than pairing a real BrowserMockup frame
// with a placeholder-only PhoneMockup.
function ScreenshotPlaceholder({ icon }: { icon?: React.ReactNode }) {
  return (
    <div className="flex h-full w-full max-w-sm flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center">
      {icon ?? <ImageOff className="h-8 w-8 text-muted-foreground/60" />}
      <p className="text-sm font-medium text-muted-foreground">
        Screenshot coming soon
      </p>
    </div>
  );
}

// Only the interactive Mobile/Desktop toggle needs to be a Client
// Component - pulled out of FeatureDetail so that component can stay a
// Server Component and accept a plain Lucide icon component (a function)
// as a prop. Passing a function prop into a Client Component isn't
// allowed (React can't serialize it across that boundary); a Server
// Component has no such restriction. `placeholderIcon` sidesteps this the
// same way StatBox's `action` prop does elsewhere in this app - it's a
// pre-rendered element (JSX), not the bare component function, so passing
// it down from FeatureDetail is fine.
export function FeatureScreenshotToggle({
  mobileSrc,
  desktopSrc,
  alt,
  placeholderIcon,
}: {
  mobileSrc?: string;
  desktopSrc?: string;
  alt: string;
  placeholderIcon?: React.ReactNode;
}) {
  const [view, setView] = useState<View>("mobile");

  return (
    <>
      <div className="flex justify-center">
        <Tabs value={view} onValueChange={(v) => v && setView(v as View)}>
          <TabsList>
            <TabsTrigger value="mobile">Mobile</TabsTrigger>
            <TabsTrigger value="desktop">Desktop</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="mx-auto mt-8 flex h-[520px] items-center justify-center">
        {view === "mobile" ? (
          mobileSrc ? (
            <PhoneMockup src={mobileSrc} alt={alt} />
          ) : (
            <ScreenshotPlaceholder icon={placeholderIcon} />
          )
        ) : desktopSrc ? (
          <BrowserMockup src={desktopSrc} alt={alt} />
        ) : (
          <ScreenshotPlaceholder icon={placeholderIcon} />
        )}
      </div>
    </>
  );
}
