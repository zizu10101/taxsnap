import {
  BarChart3,
  Briefcase,
  ClipboardList,
  FileText,
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
  | "clients"
  | "expenses"
  | "progress-billing"
  | "overview"
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
  { key: "jobs", prefixes: ["/dashboard/jobs", "/dashboard/employees", "/dashboard/hours"] },
  { key: "clients", prefixes: ["/dashboard/clients"] },
  { key: "expenses", prefixes: ["/dashboard/expenses"] },
  { key: "progress-billing", prefixes: ["/dashboard/progress-billing"] },
  { key: "overview", prefixes: ["/dashboard/overview"] },
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
];

const SALON_ITEMS: NavItem[] = [
  { key: "commission", label: "Register", href: "/dashboard/commission", icon: Scissors },
];

// Full item list for the desktop sidebar (no room limit there, unlike
// mobile) and for splitting into the mobile bottom nav's primary bar vs.
// "More" sheet below.
export function getNavItems({
  businessType,
  isPro,
}: {
  businessType: "general" | "salon";
  isPro: boolean;
}): NavItem[] {
  if (businessType === "salon") return [DASHBOARD_ITEM, ...SALON_ITEMS];
  return [DASHBOARD_ITEM, ...GENERAL_ITEMS, ...(isPro ? PRO_ITEMS : [])];
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
const MOBILE_PRIMARY_KEYS: NavKey[] = ["dashboard", "estimates", "invoices", "jobs", "commission"];

export function splitMobileNav(items: NavItem[]): {
  primary: NavItem[];
  overflow: NavItem[];
} {
  const primary = items.filter((i) => MOBILE_PRIMARY_KEYS.includes(i.key));
  const overflow = items.filter((i) => !MOBILE_PRIMARY_KEYS.includes(i.key));
  return { primary, overflow };
}
