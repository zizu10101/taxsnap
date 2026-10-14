import {
  BarChart3,
  Briefcase,
  Clock,
  FileArchive,
  FileText,
  Images,
  Landmark,
  Layers,
  MapPin,
  Receipt,
  type LucideIcon,
} from "lucide-react";

// Single source of truth for every /features/* sub-page, shared between
// the /features index page's own card grid and LandingHeader's Features
// dropdown/accordion - previously only lived inline in the index page,
// so the header would have had to duplicate this list by hand and could
// drift out of sync with it (new page added to one, forgotten in the
// other).
export interface FeaturePage {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  /**
   * How-to video slugs shown on this page (see how-to-videos.ts). A video's "Learn
   * more about this feature" link points at the FIRST page in this list that
   * names it, so order decides when two pages share a clip.
   */
  videos: string[];
}

export const FEATURE_PAGES: FeaturePage[] = [
  {
    icon: Receipt,
    title: "Automated Expense Tracking",
    description:
      "Snap a photo of any receipt or vendor invoice. TaxSnap reads it, categorizes it, and keeps a digital copy on file — no manual entry, no lost paper.",
    href: "/features/expense-tracking",
    videos: ["record-receipt-scan"],
  },
  {
    icon: FileText,
    title: "Invoicing & Estimates",
    description:
      "Build a professional estimate, convert it to an invoice once approved, and record payments as they come in — cash, card, e-transfer, whatever the client used.",
    href: "/features/invoicing",
    videos: ["estimate-to-invoice", "record-esign", "record-payment"],
  },
  {
    icon: Briefcase,
    title: "Job Costing",
    description:
      "Track profitability per job. Log materials, assign labor hours, link the invoice — see your real margin on every project, not just a guess.",
    href: "/features/job-costing",
    videos: ["job-profit"],
  },
  {
    icon: Images,
    title: "Site Photos on Every Job",
    description:
      "Snap before and after photos on the job and keep them with it. Everything stays private to you, never shown to clients.",
    href: "/features/site-photos",
    videos: ["job-photos"],
  },
  {
    icon: MapPin,
    title: "Jobs with Client and Location, Plus Private Notes",
    description:
      "Pick a client once and it follows the job. Add the job site. Private internal notes on every estimate and invoice never reach the client.",
    href: "/features/jobs",
    videos: ["job-photos"],
  },
  {
    icon: Clock,
    title: "Employee Clock-In",
    description:
      "Your crew clocks in and out of jobs from their own phone with a personal PIN. No accounts to manage, no hours to type in, and every session lands on the right job.",
    href: "/features/employee-clock-in",
    videos: [],
  },
  {
    icon: Layers,
    title: "Progress Billing",
    description:
      "Bill large jobs in draws against a contract value, track retainage, and keep a running received/remaining ledger — no spreadsheets.",
    href: "/features/progress-billing",
    videos: ["record-progress-billing"],
  },
  {
    icon: BarChart3,
    title: "Reports",
    description:
      "Revenue by client, expenses by category or vendor, and your HST position for any date range. Export your data when tax time comes.",
    href: "/features/reports",
    videos: ["record-reports"],
  },
  {
    icon: Landmark,
    title: "HST-Ready, Automatically",
    description:
      "Every receipt and invoice maps to the right CRA line items, so your HST return estimate is always current. No spreadsheets, no manual math — though we always recommend a licensed accountant for final filing.",
    href: "/features/hst-mapping",
    videos: ["record-payment", "record-receipt-scan"],
  },
  {
    icon: FileArchive,
    title: "One-Click Accountant Export",
    description:
      "Bundle receipts, invoices, and a period summary into one download — everything your accountant needs, ready to go.",
    href: "/features/accountant-export",
    videos: [],
  },
];

/** The feature page that owns a how-to video (the first to list it), if any. */
export function featurePageForVideo(slug: string): FeaturePage | undefined {
  return FEATURE_PAGES.find((f) => f.videos.includes(slug));
}
