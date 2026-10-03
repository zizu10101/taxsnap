// Receipts are stored in the private "receipts" bucket as
// `<user id>/<uuid>.<original extension>` (see POST /api/parse-receipt), so the
// stored path already says whether a file is a PDF or a photo. Pure and
// import-free so it unit-tests with plain `node --test`.

export function isPdfPath(path: string | null | undefined): boolean {
  if (!path) return false;
  // Ignore any query string a signed URL might carry.
  const clean = path.split("?")[0].toLowerCase();
  return clean.endsWith(".pdf");
}

// A response content type that means "this is a PDF". Used as the fallback
// when the path gives no hint (an upload whose filename had no extension).
export function isPdfContentType(contentType: string | null | undefined): boolean {
  return (contentType ?? "").toLowerCase().split(";")[0].trim() === "application/pdf";
}
