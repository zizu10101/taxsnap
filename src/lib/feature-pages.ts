import {
  Briefcase,
  FileArchive,
  FileText,
  Landmark,
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
}

export const FEATURE_PAGES: FeaturePage[] = [
  {
    icon: Receipt,
    title: "Automated Expense Tracking",
    description:
      "Snap a photo of any receipt or vendor invoice. TaxSnap reads it, categorizes it, and keeps a digital copy on file — no manual entry, no lost paper.",
    href: "/features/expense-tracking",
  },
  {
    icon: FileText,
    title: "Invoicing & Estimates",
    description:
      "Build a professional estimate, convert it to an invoice once approved, and record payments as they come in — cash, card, e-transfer, whatever the client used.",
    href: "/features/invoicing",
  },
  {
    icon: Briefcase,
    title: "Job Costing",
    description:
      "Track profitability per job. Log materials, assign labor hours, link the invoice — see your real margin on every project, not just a guess.",
    href: "/features/job-costing",
  },
  {
    icon: Landmark,
    title: "HST-Ready, Automatically",
    description:
      "Every receipt and invoice maps to the right CRA line items, so your HST return estimate is always current. No spreadsheets, no manual math — though we always recommend a licensed accountant for final filing.",
    href: "/features/hst-mapping",
  },
  {
    icon: FileArchive,
    title: "One-Click Accountant Export",
    description:
      "Bundle receipts, invoices, and a period summary into one download — everything your accountant needs, ready to go.",
    href: "/features/accountant-export",
  },
];
