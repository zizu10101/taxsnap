// Simplified browser-chrome frame - a slim title bar with window-control
// dots, no keyboard/base - swapped in for the previous full laptop
// silhouette (see git history) so the desktop screenshot gets much more of
// the available width at a legible size instead of being squeezed by a
// keyboard deck that added visual chrome without adding information.
//
// Sized by height (matching PhoneMockup's own reasoning): the title bar is
// a fixed shrink-0 height and the screenshot area is flex-1 + object-contain,
// so the whole frame scales to whatever height the parent's mockup-stage box
// actually grants on a given screen, rather than a fixed max-width that
// could overflow that box on a shorter one.
export function BrowserMockup({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="mx-auto flex h-full max-w-full aspect-[16/10.7] flex-col overflow-hidden rounded-lg border border-border shadow-xl">
      <div className="flex shrink-0 items-center gap-1.5 bg-foreground px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-background/40" />
        <span className="h-2.5 w-2.5 rounded-full bg-background/40" />
        <span className="h-2.5 w-2.5 rounded-full bg-background/40" />
      </div>
      <div className="min-h-0 flex-1 bg-background">
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed marketing asset, not a Next/Image-managed source */}
        <img src={src} alt={alt} className="h-full w-full object-contain object-top" />
      </div>
    </div>
  );
}
