// `src` is a pre-composed image - a real laptop product photo with the app
// screenshot already baked into its screen (transparent background), same
// approach as PhoneMockup, so no extra browser chrome is drawn around it here.
// Sized by height/object-contain for the same reason as PhoneMockup: the
// parent stage's mockup area is a flex box whose available height varies.
export function BrowserMockup({ src, alt }: { src: string; alt: string }) {
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
