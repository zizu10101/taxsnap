import { randomBytes } from "crypto";

// 24 random bytes (192 bits) as base64url - plenty of entropy to be
// unguessable, URL-safe with no characters that need escaping in a link.
// Used for documents.sign_token/view_token - deliberately not the
// sequential document_number, same reasoning as any other sensitive
// shareable link in this app.
export function generateOpaqueToken(): string {
  return randomBytes(24).toString("base64url");
}
