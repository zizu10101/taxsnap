// Staged rollout for Online payments (Connect onboarding and the Settings card).
// ONLINE_PAYMENTS_ALLOWLIST is a comma-separated list of email addresses. Unset or
// empty = open to everyone (the feature as it always was). When it has any entry, only
// those emails can see the card or start onboarding. It never affects the public
// "Pay now" link or the Connect webhook: those follow the invoice owner's account state.
export function parseOnlinePaymentsAllowlist(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isOnlinePaymentsEnabled(
  email: string | null | undefined,
  raw: string | undefined | null = process.env.ONLINE_PAYMENTS_ALLOWLIST,
): boolean {
  const allowed = parseOnlinePaymentsAllowlist(raw);
  if (allowed.size === 0) return true;
  if (!email) return false;
  return allowed.has(email.trim().toLowerCase());
}

export const ONLINE_PAYMENTS_UNAVAILABLE_CODE = "ONLINE_PAYMENTS_UNAVAILABLE" as const;
export const ONLINE_PAYMENTS_UNAVAILABLE_MESSAGE = "Online payments are not available on your account yet." as const;
