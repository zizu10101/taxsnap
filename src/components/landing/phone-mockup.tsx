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
//
// The source asset is also pre-cropped (top 16px / bottom 26px trimmed,
// pixel amounts measured from the frame's own SY/SH bezel coordinates) to
// remove the phone's dead chrome above/below the screen while leaving the
// side bezels untouched - done once on the asset rather than via CSS
// object-fit cropping, since a live crop's ratio would otherwise shift
// with the container's aspect ratio at different viewport widths.
//
// Sized by height, not a fixed max-width: the parent stage's mockup area
// is a flex-1 box whose available height shrinks a little depending on
// how many lines the title/description wrap to for a given screen, so a
// fixed pixel width that happened to fit one screen's text block could
// overflow the stage on another (or on a narrower real-phone viewport)
// and get clipped/collide with the pagination dots below it. h-full +
// object-contain lets the image size itself to whatever height the flex
// box actually grants, on every screen and viewport, with no manual
// pixel tuning.
export function PhoneMockup({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="h-full w-full">
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed marketing asset, not a Next/Image-managed source */}
      <img
        src={src}
        alt={alt}
        className="mx-auto h-full w-full object-contain drop-shadow-xl"
      />
    </div>
  );
}
