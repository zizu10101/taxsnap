import { BILLING_CHANGE_POLICY } from "@/lib/pricing-plans";
import { FEE_AND_DISPUTE_WORDING } from "@/lib/online-payments-terms";

export interface SiteFaqItem {
  question: string;
  answer: string;
  /** Shown on the homepage; every item is on /faq. */
  home?: boolean;
  /** A how-to video that shows the answer; linked only while that video is published. */
  videoSlug?: string;
}

// General-business question set - Jobs applies here (hidden entirely for
// salon accounts elsewhere in the app) and invoicing covers both Invoices
// and Estimates (also general-only). Shared by the homepage (the `home`
// items) and /faq (all of them, plus the FAQPage JSON-LD), so the two can't
// drift. Plan caps and storage numbers deliberately stay out of the answers:
// the pricing section is the one place they live.
export const SITE_FAQ_ITEMS: SiteFaqItem[] = [
  {
    question: "What is TaxSnap?",
    answer:
      "TaxSnap is a receipt scanning, expense, invoicing and HST tracking app for Canadian contractors and small businesses. It shows your HST numbers; it does not file your return.",
    home: true,
  },
  {
    question: "How does the AI scanning work?",
    answer:
      "Snap or upload a photo of a receipt and TaxSnap's AI reads it automatically - merchant, date, total, tax, and a suggested write-off category are filled in for you to review before saving. No manual data entry.",
    home: true,
    videoSlug: "record-receipt-scan",
  },
  {
    question: "What happens after my free scans run out?",
    answer:
      "The Free plan includes a monthly allowance of receipt scans at no cost. Once you hit it, upgrade to Pro for unlimited scans - or just wait, since the allowance resets automatically at the start of each month either way.",
    home: true,
  },
  {
    question: "Can I use this on my computer, or only my phone?",
    answer:
      "Both. TaxSnap is a full web app that works in any browser on your computer, and it's also an installable app (PWA) you can add to your phone's home screen for a native-app-like experience - no app store required either way.",
  },
  {
    question: "Do I need to install any software?",
    answer:
      "No - TaxSnap is a Progressive Web App, so it works directly in any browser with nothing to download. If you'd like quicker access, you can optionally install it to your phone or computer's home screen, just like a native app - but it's never required.",
  },
  {
    question: "How does billing and cancellation work?",
    answer: `Plans are billed monthly or annually (2 months free) - your choice. Once you're subscribed, use Manage Subscription from Settings or Billing to change your billing interval or cancel anytime, no need to contact support. ${BILLING_CHANGE_POLICY}`,
    home: true,
  },
  {
    question: "Can clients dispute card payments?",
    answer: `Yes. When a client pays an invoice by card, the money goes to your own Stripe account and you are the seller. ${FEE_AND_DISPUTE_WORDING} TaxSnap adds no fee.`,
  },
  {
    question: "What does “HST mapping” mean?",
    answer:
      "TaxSnap automatically maps your income and expenses to the actual CRA line numbers on the Ontario GST/HST return (Lines 101, 103, and 106), so you get a running estimate of what you owe. It's a planning tool, not a filing service - always confirm final numbers with a bookkeeper or accountant.",
    home: true,
  },
  {
    question: "How do invoices and estimates work?",
    answer:
      "Create a professional invoice or estimate in a few taps - pick a client, add line items, and TaxSnap calculates HST and totals automatically. Estimates convert into invoices with one click once a client approves. Invoicing is included on every plan.",
    home: true,
    videoSlug: "estimate-to-invoice",
  },
  {
    question: "Can I share an estimate or invoice with a client?",
    answer:
      "Yes - share a PDF straight from your phone's share sheet (WhatsApp, Messages, email, and more) on mobile, or email or download it directly on desktop.",
  },
  {
    question: "Can I add my business logo?",
    answer:
      "Yes. Upload it once in Settings and it appears automatically on every invoice, estimate, and PDF report you generate.",
  },
  {
    question: "What are Jobs?",
    answer:
      "Jobs let you tag receipts to a specific project and track employee hours against it, so you can see the true cost of any job - materials plus labor - kept separate from your regular tax tracking. Every plan includes Jobs.",
    videoSlug: "job-profit",
  },
  {
    question: "Can I attach site photos to a job?",
    answer:
      "Yes. Snap before and after photos on the job and file them under it, or save them as unsorted and sort them later. Photos are private to you - they aren't shown to clients or added to invoices.",
    videoSlug: "job-photos",
  },
  {
    question: "What reports do I get?",
    answer:
      "Your dashboard shows running totals for expenses, deductible spend, and estimated tax savings, plus the Ontario HST Return Helper for a real-time view of what you owe. Reports add revenue by client, expenses by category or vendor, and your HST position for any date range.",
    videoSlug: "record-reports",
  },
  {
    question: "Can I export my data?",
    answer:
      "Yes. Export a plain CSV of your receipts anytime, including a QuickBooks-ready version, and download invoice PDFs whenever you need them.",
  },
];

export const HOME_FAQ_ITEMS = SITE_FAQ_ITEMS.filter((i) => i.home);
