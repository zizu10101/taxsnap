import {
  BarChart3,
  Briefcase,
  ClipboardList,
  FileBarChart,
  FileText,
  HardHat,
  LayoutDashboard,
  PieChart,
  Scissors,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavKey =
  | "dashboard"
  | "estimates"
  | "invoices"
  | "jobs"
  | "employees"
  | "clients"
  | "expenses"
  | "progress-billing"
  | "overview"
  | "reports"
  | "commission";

export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  icon: LucideIcon;
}

// Every route each item's active state covers - mirrors exactly the
// `active="…"` value each page.tsx passed to the old DashboardHeader, just
// centralized here instead of threaded through 21 individual pages. Order
// matters for matching (see getActiveNavKey): longest/most specific
// prefixes are naturally disjoint here (e.g. "/dashboard/commission/overview"
// never collides with the standalone "/dashboard/overview" entry), so a
// simple first-match-wins scan is safe.
const NAV_ROUTES: { key: NavKey; prefixes: string[] }[] = [
  { key: "estimates", prefixes: ["/dashboard/estimates"] },
  { key: "invoices", prefixes: ["/dashboard/invoices", "/dashboard/line-items"] },
  { key: "jobs", prefixes: ["/dashboard/jobs"] },
  // Employees owns the Hours page too: logging, reviewing and correcting hours
  // (including clocked sessions) is day-to-day employee management, not
  // job setup. Routes are unchanged - only which tab lights up.
  { key: "employees", prefixes: ["/dashboard/employees", "/dashboard/hours"] },
  { key: "clients", prefixes: ["/dashboard/clients"] },
  { key: "expenses", prefixes: ["/dashboard/expenses"] },
  { key: "progress-billing", prefixes: ["/dashboard/progress-billing"] },
  { key: "overview", prefixes: ["/dashboard/overview"] },
  { key: "reports", prefixes: ["/dashboard/reports"] },
  { key: "commission", prefixes: ["/dashboard/commission"] },
];

export function getActiveNavKey(pathname: string): NavKey | undefined {
  if (pathname === "/dashboard") return "dashboard";
  for (const { key, prefixes } of NAV_ROUTES) {
    if (prefixes.some((p) => pathname.startsWith(p))) return key;
  }
  return undefined;
}

const DASHBOARD_ITEM: NavItem = {
  key: "dashboard",
  label: "Dashboard",
  href: "/dashboard",
  icon: LayoutDashboard,
};

const GENERAL_ITEMS: NavItem[] = [
  { key: "estimates", label: "Estimates", href: "/dashboard/estimates", icon: ClipboardList },
  { key: "invoices", label: "Invoices", href: "/dashboard/invoices", icon: FileText },
  { key: "jobs", label: "Jobs", href: "/dashboard/jobs", icon: Briefcase },
  { key: "employees", label: "Employees", href: "/dashboard/employees", icon: HardHat },
  { key: "clients", label: "Clients", href: "/dashboard/clients", icon: Users },
  { key: "expenses", label: "Expenses", href: "/dashboard/expenses", icon: BarChart3 },
];

const PRO_ITEMS: NavItem[] = [
  {
    key: "progress-billing",
    label: "Progress Billing",
    href: "/dashboard/progress-billing",
    icon: Target,
  },
  { key: "overview", label: "Overview", href: "/dashboard/overview", icon: PieChart },
  { key: "reports", label: "Reports", href: "/dashboard/reports", icon: FileBarChart },
];

const SALON_ITEMS: NavItem[] = [
  { key: "commission", label: "Register", href: "/dashboard/commission", icon: Scissors },
];

// Full item list for the desktop sidebar (no room limit there, unlike
// mobile) and for splitting into the mobile bottom nav's primary bar vs.
// "More" sheet below.
//
// `hiddenKeys` is the owner's own "Hide from my menu" choices (Settings ->
// Navigation): purely cosmetic - it only drops tabs from this list. It never
// affects tier access, API permissions or whether a page loads by URL. Only
// HIDEABLE_NAV_KEYS can be hidden (never Dashboard, never a salon's Register),
// and `keepKey` (the tab for the page being viewed) is always kept so opening a
// hidden tab by link doesn't make you lose your place in the menu.
export function getNavItems({
  businessType,
  isPro,
  hiddenKeys,
  keepKey,
}: {
  businessType: "general" | "salon";
  isPro: boolean;
  hiddenKeys?: readonly string[];
  keepKey?: NavKey;
}): NavItem[] {
  if (businessType === "salon") return [DASHBOARD_ITEM, ...SALON_ITEMS];
  const items = [DASHBOARD_ITEM, ...GENERAL_ITEMS, ...(isPro ? PRO_ITEMS : [])];
  if (!hiddenKeys || hiddenKeys.length === 0) return items;
  const hidden = new Set(sanitizeHiddenNavKeys(hiddenKeys));
  return items.filter((i) => !hidden.has(i.key as HideableNavKey) || i.key === keepKey);
}

// The tabs an owner may hide from their own menu. Dashboard is the home anchor
// and always shown; Settings isn't a nav tab; a salon's menu (Dashboard +
// Register) has nothing to declutter. Overview and Reports are Pro-only views -
// hiding them is harmless for accounts that don't see them at all.
export const HIDEABLE_NAV_KEYS = [
  "estimates",
  "invoices",
  "jobs",
  "employees",
  "clients",
  "expenses",
  "progress-billing",
  "overview",
  "reports",
] as const satisfies readonly NavKey[];

export type HideableNavKey = (typeof HIDEABLE_NAV_KEYS)[number];

// Whatever reached us (a request body, a stored column) down to known, de-duped
// hideable keys, in the canonical order. Anything else is silently ignored.
export function sanitizeHiddenNavKeys(input: unknown): HideableNavKey[] {
  if (!Array.isArray(input)) return [];
  const wanted = new Set(input.filter((k): k is string => typeof k === "string"));
  return HIDEABLE_NAV_KEYS.filter((k) => wanted.has(k));
}

// Mobile bottom nav only has room for 4 primary icons + a "More" slot (see
// design_handoff_taxsnap_dashboard/README.md's 5-column bottom nav). The
// mockup's own primary set (Dashboard/Jobs/Invoices/Expenses) drops
// Estimates entirely, which would be a real functional regression - today's
// nav puts Estimates ahead of Invoices, and it's also the first quick-action
// tile. Keeping Estimates primary and moving Expenses into "More" instead
// (confirmed with the user - see PR/commit history around this change).
// "commission" is included here too - a salon account's item list never
// contains estimates/invoices/jobs and a general account's never contains
// commission, so this one list naturally produces "Dashboard, Estimates,
// Invoices, Jobs" for general and "Dashboard, Register" for salon without
// a separate business-type branch.
//
// The primary bar is simply the first MOBILE_PRIMARY_SLOTS items in nav order,
// which for a general account is exactly Dashboard, Estimates, Invoices, Jobs
// (and for a salon, Dashboard + Register). Working from the (already filtered)
// list means that when an owner hides one of those tabs, the next visible tab
// is promoted into the freed slot, so the bar stays full.
const MOBILE_PRIMARY_SLOTS = 4;

export function splitMobileNav(items: NavItem[]): {
  primary: NavItem[];
  overflow: NavItem[];
} {
  return {
    primary: items.slice(0, MOBILE_PRIMARY_SLOTS),
    overflow: items.slice(MOBILE_PRIMARY_SLOTS),
  };
}
