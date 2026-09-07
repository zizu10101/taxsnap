// `src` is a pre-composed image - a real phone product photo with the app
// screenshot baked into its screen area at the pixel level (via a one-off
// sharp script, not checked into this repo), clipped to the exact same
// rounded-rect mask used to punch the screen hole in the source photo.
// Baking it once (rather than layering screenshot + frame + camera-dot
// patch live via CSS) is what actually gets a seamless, edge-to-edge
// result - the two layers only lined up pixel-for-pixel once both were
// clipped with the identical mask in the same tool, not approximated with
// a CSS border-radius guess (which is what produced a visible gap/seam
// around the screenshot the first time this was built).
export function PhoneMockup({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="w-full max-w-[200px]">
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed marketing asset, not a Next/Image-managed source */}
      <img src={src} alt={alt} className="w-full drop-shadow-xl" />
    </div>
  );
}
