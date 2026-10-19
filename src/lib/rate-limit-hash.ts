import { createHash } from "node:crypto";

// Hashed before storing: no raw invoice token or IP address sits in the
// checkout_attempts table. Server-only (node:crypto), kept out of connect-status.ts
// because the Settings card imports that file in the browser.
export function hashForRateLimit(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
