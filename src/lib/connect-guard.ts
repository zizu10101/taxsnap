// The Connect routes and webhook move REAL money, so they refuse to run with a live
// Stripe key anywhere but production. Local `next dev` (NODE_ENV=development) and
// test runs must use the Taxsnap sandbox `sk_test_` key. On Vercel, preview
// deployments also build with NODE_ENV=production, so a live key is additionally
// refused when VERCEL_ENV says this is not the production deployment.
// Import-free so it can be unit-tested with `node --test`.

export const CONNECT_LIVE_KEY_MESSAGE =
  "Online payments refuse to run with a live Stripe key outside production. Use the Taxsnap sandbox sk_test_ key locally.";

export function connectKeyProblem(
  secretKey: string | undefined,
  env: { NODE_ENV?: string; VERCEL_ENV?: string },
): string | null {
  if (!secretKey) return "STRIPE_SECRET_KEY is not set.";
  if (!secretKey.startsWith("sk_live_")) return null;
  if (env.NODE_ENV !== "production") return CONNECT_LIVE_KEY_MESSAGE;
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "production") return CONNECT_LIVE_KEY_MESSAGE;
  return null;
}

// Test-mode events must never move a live ledger and vice versa: the webhook
// ignores any event whose livemode doesn't match the key this deployment holds.
export function eventMatchesKeyMode(livemode: boolean, secretKey: string | undefined): boolean {
  return livemode === Boolean(secretKey?.startsWith("sk_live_"));
}
