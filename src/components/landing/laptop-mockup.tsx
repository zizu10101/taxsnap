// Matching CSS-built counterpart to PhoneMockup - a simplified laptop
// silhouette (screen bezel + hinge + keyboard deck), same graphite chassis
// color, so the two device frames read as one visual system rather than a
// phone illustration paired with a plain browser screenshot.
export function LaptopMockup({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="w-full max-w-xl">
      <div className="rounded-t-xl bg-foreground p-2 pb-1 shadow-xl">
        <div className="relative aspect-[16/10] overflow-hidden rounded-md bg-background">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed marketing asset, not a Next/Image-managed source */}
          <img src={src} alt={alt} className="h-full w-full object-cover object-top" />
        </div>
      </div>
      {/* Hinge bar */}
      <div className="relative h-2.5 bg-foreground">
        <div className="absolute top-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-b-sm bg-background/10" />
      </div>
      {/* Keyboard deck/base - wider than the screen, tapered corners, for
          the classic laptop-viewed-from-slightly-above silhouette. */}
      <div
        className="mx-auto h-3 rounded-b-2xl bg-foreground/90"
        style={{ width: "104%", marginLeft: "-2%" }}
      />
    </div>
  );
}
