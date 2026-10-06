// SHA-256 of a file's bytes, as 64 lowercase hex characters. Used to recognise a receipt file the
// owner has already scanned. Computed in the BROWSER on the original file, before the photo is
// compressed for upload: it is a fingerprint of what the person picked, and only the hash is ever
// stored (receipts.file_sha256) - never the file. Web Crypto only (no import), so it also runs under
// `node --test`.

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
