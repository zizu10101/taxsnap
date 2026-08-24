export interface CompressImageOptions {
  maxWidth?: number;
  quality?: number;
  mimeType?: "image/jpeg" | "image/webp";
}

// Downscales an image client-side before it's uploaded, so a 12MP phone
// photo doesn't get sent (and billed to Gemini) at full resolution. Only
// scales down, never up, and falls back to the original file on any
// failure (e.g. a format the browser's <img> can't decode).
export async function compressImage(
  file: File,
  { maxWidth = 1024, quality = 0.85, mimeType = "image/jpeg" }: CompressImageOptions = {},
): Promise<File> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, maxWidth / image.naturalWidth);
    const width = Math.round(image.naturalWidth * scale);
    const height = Math.round(image.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is not available");
    ctx.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeType, quality),
    );
    if (!blob) throw new Error("Failed to encode compressed image");

    const extension = mimeType === "image/webp" ? "webp" : "jpg";
    const baseName = file.name.replace(/\.[^.]+$/, "") || "receipt";

    return new File([blob], `${baseName}.${extension}`, {
      type: mimeType,
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for compression"));
    img.src = src;
  });
}
