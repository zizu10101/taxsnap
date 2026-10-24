// Links on the in-app Help page. The marketing pages live in this same app, so these are
// plain paths; Help opens them in a new tab. The video list itself is NOT kept here: the
// Help page reads it from the same source as the public /how-to page, so the two always match.

export const HOW_TO_INDEX_HREF = "/how-to";

export function howToHref(slug: string): string {
  return `${HOW_TO_INDEX_HREF}/${slug}`;
}

export interface HelpLink {
  label: string;
  href: string;
}

export const HELP_GUIDE_LINKS: readonly HelpLink[] = [
  { label: "Common questions", href: "/faq" },
  { label: "What TaxSnap can do", href: "/features" },
];

export const HELP_LEGAL_LINKS: readonly HelpLink[] = [
  { label: "Terms of Service", href: "/terms" },
  { label: "Privacy Policy", href: "/privacy" },
];

export const HELP_PATH = "/dashboard/help";
