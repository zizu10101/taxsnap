import { encodeDisplay, encodeThumbnail } from "./photo-sizing.ts";

// Browser half of photo compression. The ORIGINAL file is never uploaded: it is decoded, drawn onto a
// canvas and re-encoded as a JPEG twice (display image + thumbnail). A canvas re-encode carries over no
// EXIF at all - no location, no camera data - and the orientation is applied while drawing, so the
// result is always upright. All the sizes and qualities are in photo-config.ts; the stepping logic is
// in photo-sizing.ts (tested without a browser).

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

// imageOrientation "from-image" bakes the EXIF rotation into the pixels; the <img> fallback does the
// same in every current browser (image-orientation: from-image is the default).
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // fall through to the <img> path
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("This photo couldn't be read."));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawJpeg(
  decoded: Decoded,
  size: { width: number; height: number },
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("This browser can't process photos."));
  // JPEG has no transparency: paint white first so a PNG/HEIC with alpha doesn't turn black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(decoded.source, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("This photo couldn't be processed."))),
      "image/jpeg",
      quality,
    ),
  );
}

export interface PreparedPhoto {
  photo: Blob;
  thumb: Blob;
  // The file's own timestamp (when the picture was taken, for a camera shot), ISO.
  takenAt: string;
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const decoded = await decode(file);
  try {
    const encode = (size: { width: number; height: number }, quality: number) =>
      drawJpeg(decoded, size, quality);
    const display = await encodeDisplay(decoded.width, decoded.height, encode);
    const thumb = await encodeThumbnail(decoded.width, decoded.height, encode);
    const takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString();
    return { photo: display.blob, thumb: thumb.blob, takenAt };
  } finally {
    decoded.close();
  }
}
