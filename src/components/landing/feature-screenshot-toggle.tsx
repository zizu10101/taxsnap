"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PhoneMockup } from "@/components/landing/phone-mockup";
import { BrowserMockup } from "@/components/landing/browser-mockup";

type View = "mobile" | "desktop";

// Only the interactive Mobile/Desktop toggle needs to be a Client
// Component - pulled out of FeatureDetail so that component can stay a
// Server Component and accept a plain Lucide icon component (a function)
// as a prop. Passing a function prop into a Client Component isn't
// allowed (React can't serialize it across that boundary); a Server
// Component has no such restriction.
export function FeatureScreenshotToggle({
  mobileSrc,
  desktopSrc,
  alt,
}: {
  mobileSrc: string;
  desktopSrc: string;
  alt: string;
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
          <PhoneMockup src={mobileSrc} alt={alt} />
        ) : (
          <BrowserMockup src={desktopSrc} alt={alt} />
        )}
      </div>
    </>
  );
}
