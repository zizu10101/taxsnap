# TaxSnap

A mobile-first PWA that helps self-employed trade contractors (painters,
handymen, barbers, etc.) snap photos of receipts, auto-categorize tax
write-offs with Gemini, and export clean data for tax season.

**Stack:** Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui ·
Supabase (Postgres + Auth + Storage) · Google Gemini 3.6 Flash · Stripe.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run `supabase/migrations/0001_init.sql`. This creates
   the `profiles`, `receipts`, and `invoices` tables with row-level security,
   a trigger that auto-creates a profile on signup, and a private `receipts`
   storage bucket for uploaded photos.
3. Copy your Project URL, anon key, and service role key from
   **Project Settings -> API**.

### 3. Get a Gemini API key

Create a key at [Google AI Studio](https://aistudio.google.com/apikey).

### 4. Set up Stripe

1. Create two recurring Prices in the Stripe Dashboard: Basic ($9/mo) and
   Pro ($29/mo).
2. Create a webhook endpoint pointing at `/api/stripe/webhook` listening for
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, and `customer.subscription.deleted`.
   For local development, use the Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

### 5. Configure environment variables

Copy `.env.local.example` to `.env.local` and fill in the values from steps
2-4:

```bash
cp .env.local.example .env.local
```

### 6. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app is installable
as a PWA (Add to Home Screen) once served over HTTPS or from localhost.

## Project structure

- `src/app` - routes (App Router): `/`, `/auth`, `/dashboard`, `/billing`,
  `/invoices`, and API routes under `src/app/api`.
- `src/components` - UI components; `src/components/ui` holds shadcn
  primitives.
- `src/lib` - Supabase clients, Gemini receipt parsing, Stripe client, CSV
  export, and shared types.
- `supabase/migrations` - SQL schema and RLS policies.
- `public/manifest.json`, `public/sw.js` - PWA manifest and service worker.

## Key flows

- **Receipt capture**: `UploadReceipt` (`src/components/dashboard/upload-receipt.tsx`)
  uploads a photo to `/api/parse-receipt`, which stores the image in Supabase
  Storage and calls Gemini with a strict JSON schema to extract merchant,
  date, totals, tax, and category. The result is shown in a preview modal for
  the user to edit; "Approve & Save" posts to `/api/receipts`, which inserts
  the row into the `receipts` table.
- **Billing**: `/billing` calls `/api/stripe/checkout` to start a Checkout
  Session for the Basic or Pro price. The webhook updates
  `profiles.subscription_status`, which gates the `/invoices` page (Pro only).
- **Export**: the dashboard's "Export CSV" button builds an IRS/Schedule-C
  style spreadsheet client-side from the loaded receipts.
