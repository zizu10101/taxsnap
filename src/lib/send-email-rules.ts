// What POST /api/documents/[id]/send-email accepts as the PDF to attach. Pure, so it is tested.

// Vercel rejects request bodies over ~4.5 MB before the route runs; stay under it.
export const MAX_EMAIL_PDF_BYTES = 4 * 1024 * 1024;

export function checkPdfUpload(bytes: Uint8Array): { status: number; error: string } | null {
  if (bytes.length === 0) return { status: 400, error: "Attach the PDF to send." };
  if (bytes.length > MAX_EMAIL_PDF_BYTES) {
    return { status: 413, error: "That PDF is too large to email - use Download PDF instead." };
  }
  // "%PDF" - the file must really be a PDF, not whatever the request happened to carry.
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (!isPdf) return { status: 400, error: "The attachment is not a PDF." };
  return null;
}
