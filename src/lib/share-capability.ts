// Feature-detected device+capability check for whether the real OS share
// sheet (with file support) is available - requires *both* a mobile-shaped
// UA/touch signature and navigator.canShare({files}), since capability
// alone isn't a reliable mobile/desktop signal any more (Edge/Chrome on
// Windows and Safari on macOS now support it too, which would put a
// desktop-only fallback UI behind a check that's true on plenty of actual
// desktops - this bit us once, see share-document-button.tsx history).
export function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const isAppleTouch = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent) || isAppleTouch;
}

export function canShareFiles() {
  return (
    isMobileDevice() &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({
      files: [new File([], "x.pdf", { type: "application/pdf" })],
    })
  );
}

export function noSubscription() {
  return () => {};
}

export function getServerFalse() {
  return false;
}
