# DRAFT - FOR LAWYER REVIEW - NOT PUBLISHED, NOT LEGAL ADVICE

Brief for reviewing the TaxSnap Terms of Service (`/terms`) and Privacy Policy (`/privacy`).
Both pages are written from what the code does. They are `noindex` and left out of the sitemap until you sign off
(`src/app/terms/page.tsx`, `src/app/privacy/page.tsx`; versions in `src/lib/legal-versions.ts`).
The Online payments section reuses `docs/legal-drafts/online-payments-terms-DRAFT.md` and the wording in
`src/lib/online-payments-terms.ts` (the fee and dispute sentences are imported, not copied).

## The product in five sentences

1. TaxSnap is a mobile-first web app (PWA) for self-employed trade contractors and small businesses in Ontario, Canada.
2. Users photograph receipts, an AI model (Google Gemini) reads them into expenses, and the app estimates HST and produces reports.
3. Pro users create invoices and estimates, email or share them with clients, record payments, and track jobs, employee hours and site photos.
4. Owners can give employees, clients and their accountant limited read/clock-in access through their own link and PIN.
5. Optionally a contractor connects their own Stripe account so clients can pay an invoice by card; TaxSnap only records the result.

## Decisions made by the owner (draft 3, version 2026-10-draft-3)

- **Terms section 11 changed in draft 3 (Stripe fees).** The sentence "Stripe's processing fee is shown for information only and is not part of your HST totals" now reads "Stripe's processing fee is recorded as an expense with no tax and is not part of your HST totals", and the fee wording (also shown in the Online payments card and the confirmation dialog) gained "Fees are recorded as an expense without tax. Check your Stripe statement if tax is shown." Reason: TaxSnap now records each Stripe processing fee and dispute fee as an expense automatically, with no tax and so no input tax credit (the owner's accountant's instruction); the owner can switch this off in Settings. Please confirm the wording.

- **Retention:** records are kept while the account is open. On a deletion request we delete within 30 days, except billing records we must keep by law; users are told to export first. Provider backups and logs may keep data for a limited time. Please confirm the 30-day promise and that the exception is worded correctly.
- **Gemini:** wording unchanged ("We have not set any option about how Google may use submitted content"). **The owner is verifying which Google tier / terms apply to the Gemini API key.** Update the wording once known.
- **Deletion:** by email only. A runbook is in `docs/legal-drafts/deletion-runbook.md`.
- **Hosting regions:** Supabase = United States (Oregon), owner-confirmed. Vercel region unconfirmed, so Privacy section 5 is general (see open question 21).
- **Contact:** both pages read one constant, `LEGAL_CONTACT_EMAIL` in `src/lib/legal-versions.ts`, currently the placeholder `[CONTACT_EMAIL]`. Owner to set it (the public FAQ footer shows `info@gettaxsnap.ca`).
- **Liability cap:** the greater of the fees paid in the previous 12 months and CA$100.
- **Subscription refunds:** no refunds for a started period unless we decide otherwise or the law requires; one exception: a full refund within 14 days of a first annual Pro purchase.
- **Staff access:** TaxSnap staff may access account data only to provide support or maintain the service (Terms section 5, Privacy section 3). The admin area (`src/app/admin`) exists for this.
- **Statement import removed from both pages for now.** It is built but off for everyone. When it launches, re-add to the Privacy Policy: (a) collection - statement pages read with AI, the file itself is not stored, only extracted lines; (b) Google/Gemini receives the statement pages as it does receipt images; (c) retention - unfinished statement drafts are purged after 14 days (`vercel.json` cron, `purge_stale_statement_drafts`); and in the Terms the "statements" mention in the AI-accuracy sentence (section 2). `src/lib/legal-pages.test.ts` currently fails if statement text creeps back in; update it at the same time.

## Questions still open

1. **AI training / Google tier:** owner is verifying (see above). Until then the policy says only that we set no option.
2. **Account deletion mechanics:** SQL cascades remove database rows but not storage files or Stripe objects; the runbook covers them. Confirm the process satisfies PIPEDA access/deletion duties, and whether billing records the law requires us to keep need a stated period.
3. **Export:** CSV, PDF and the Pro bundle exist; no single "download all my data". Is manual fulfilment by email enough for an access request?
4. **Hosting regions:** Supabase is in Oregon, USA (owner-confirmed); see question 21 for Vercel. Data therefore sits outside Canada; confirm that the Privacy wording about cross-border processing is enough.
5. **Stripe Connect role:** accounts are created with the contractor owning a full Stripe account; direct charges, no TaxSnap fee. Confirm the "not a payment processor / money services business" characterisation, the Stripe agreement names for Canadian connected accounts, and whether TaxSnap's part in creating the connected account changes it.
6. **Automatic refund of a double payment:** the only Stripe write TaxSnap makes on a contractor's account. The Terms present it as the one exception to "TaxSnap does not handle refunds". Confirm wording and liability.
7. **Liability cap:** enforceability in Ontario of the CA$100 floor, and any consumer/business distinction.
8. **Subscription refund wording:** the "first annual purchase" 14-day refund and the "cancel at end of period" text (`BILLING_CHANGE_POLICY`). The code does not enforce the 14-day window; refunds are given by hand via the admin refund tool.
9. **HST wording:** prices are CAD plus HST, Stripe Tax adds it at checkout. Confirm the entity's HST registration and how to state it.
10. **Privacy officer / postal address:** none named; PIPEDA expects an accountable person.
11. **Third-party personal data:** owners enter clients' and employees' personal information; TaxSnap is framed as the owner's service provider. Is a data-processing clause needed?
12. **Estimate e-signature:** stores typed name, time and IP (`signer_ip`). Should the Terms say anything about a signature's effect?
13. **Breach notification:** general terms only; there's no documented incident process in the repo.
14. **Age:** "at least 18" is stated but not checked by the app.
15. **Consent records:** only the Online payments acceptance time is stored. Sign-in says "By continuing you agree" with links and records nothing. `legal-versions.ts` exists so a version can be stored later.
16. **Governing law and forum:** Ontario and federal laws of Canada as instructed; the forum sentence is mine.
17. **Indemnity:** the Terms have no indemnity clause beyond the online payments responsibility wording. Should the user indemnify us for their content, invoices, unlawful use and tax positions, and how far?
18. **Severability:** none included. Add a severability (and entire-agreement / no-waiver) clause?
19. **TaxSnap IP clause:** the Terms say the user owns their content but nothing about our ownership of the software, brand and templates, a licence to use them, or feedback. Add one?
20. **Legal entity:** what type of entity is Edge Digital Business Solutions (sole proprietorship, corporation, partnership)? It is named in both pages without a form or registered address, and that decides how the contracting party and liability are described.
21. **Vercel region:** confirm the Vercel function region; Privacy section 5 is deliberately general until then.
22. **Online payments draft file:** clause 6 of `online-payments-terms-DRAFT.md` was updated because refunds and lost disputes are now mirrored. The file's intro still says no Terms page exists.

## Factual claims taken from the code

### Terms
| Claim | Source |
|---|---|
| Free and Pro plans; Pro CAD $29/mo or $290/yr; plus HST; billed through Stripe | `src/lib/pricing-plans.ts`; CLAUDE.md "Plan gating & pricing"; `src/lib/stripe-checkout.ts` |
| Free plan has usage limits that can change | `src/lib/plan-limits.ts` |
| "Created with TaxSnap" credit on Free invoices (PDF, online invoice page, emailed invoices), not on Pro or estimates | `src/lib/invoice-footer.ts` |
| Cancel/interval changes: monthly to annual immediate, otherwise end of period | `BILLING_CHANGE_POLICY` in `src/lib/pricing-plans.ts` |
| Other people (employees, clients, accountant) get limited access by link and PIN | CLAUDE.md "Employee login", "Client portal", "Accountant portal"; `src/lib/*-route-guard.ts` |
| Receipts read by AI | `src/lib/gemini.ts` |
| Online payments: card payments only; contractor's own Stripe account; direct charge; no TaxSnap fee; CAD; Canada | `src/app/api/public/invoice/[token]/checkout/route.ts` (`payment_method_types: ["card"]`), `src/lib/stripe-connect.ts`, CLAUDE.md "Online invoice payments" |
| Fee, dispute and responsibility sentences | `src/lib/online-payments-terms.ts` (imported) |
| Successful payments recorded; refunds and lost disputes mirrored as negative payments; open dispute changes nothing | `src/lib/online-payments.ts`, `src/lib/online-refunds.ts`, CLAUDE.md "Phase 4" |
| Stripe processing fee and dispute fee recorded as an expense with no tax, not in HST totals; owner can switch it off (section 11) | `src/lib/stripe-fee-expense.ts`, `src/lib/online-payments.ts` (`stripe_fee`), migration 0071 |
| Double payment: only the balance is recorded, the excess is refunded automatically | `src/lib/online-refunds.ts` (`settleExcess`), `src/lib/stripe-connect.ts` (`createConnectExcessRefund`) |
| Client email at checkout used only to email a receipt | `src/lib/online-payments.ts`, `src/lib/email.ts` (`sendPaymentReceiptEmail`) |
| TaxSnap records the time the owner accepted the online payments terms | `src/app/api/stripe/connect/start/route.ts`, migration 0068 |
| Online payments depends on Stripe, Canadian businesses, CAD | CLAUDE.md "Online invoice payments" |

### Privacy
| Claim | Source |
|---|---|
| Account: email, password (hashed by the sign-in service) or Google sign-in | `src/app/auth/auth-form.tsx`, Supabase Auth |
| Business profile fields (name, address, phone, email, logo, province, business number) | `supabase/migrations/0006_business_profile.sql`, `0065`, `0066` |
| Receipt photo and extracted fields; stored in a private bucket; deleting a receipt removes its photo | `src/app/api/receipts/[id]/route.ts` (storage `remove`), `supabase/migrations` (receipts) |
| Clients, employees (rates, hours, clock times), jobs, documents, payments | `supabase/migrations/0004`, `0008`, `0009`, `0010`, `0043` |
| Employee, client and accountant PINs stored hashed, lockouts after repeated misses | migrations `0043`, `0050`, `0051` |
| Site photos re-encoded in the browser, no EXIF or location; deleting a job removes its photos | `src/lib/photo-compress.ts`, `src/lib/job-photos-server.ts`, CLAUDE.md "Site photos" |
| Estimate signature stores typed name, time, IP | `src/app/api/sign/[token]/route.ts`, migration `0038` |
| IP addresses used for rate limiting, stored hashed (checkout attempts) | migration `0067`, `src/lib/online-payments*.ts` |
| Receipt image goes to Gemini with a prompt containing today's date only; no name or account details | `src/lib/gemini.ts` (`parseReceiptImage`) |
| Stripe handles subscription billing and (if used) client card payments; TaxSnap gets no card numbers | `src/app/api/stripe/webhook/route.ts`, `src/lib/stripe-connect.ts` |
| Resend sends invoices/estimates, payment receipts and owner notices | `src/lib/email.ts` |
| No analytics, advertising or tracking: no such dependency or script | `package.json`, `src/app/layout.tsx`; pinned by `src/lib/legal-pages.test.ts` |
| Payer's email entered at Stripe Checkout is received and used only to email a receipt (the code reads and uses the email only; the name is part of Stripe's event data but nothing in the code reads or stores it; owner asked for both to be disclosed) | `src/lib/online-payments.ts` (`customer_details`, `receiptRecipient`), `src/lib/email.ts` (`sendPaymentReceiptEmail`) |
| Hosting: Supabase database and storage in the United States (Oregon), owner-confirmed; Vercel region unconfirmed, so the page says requests may be processed in the United States, Canada or other regions | owner (not in the repo) |
| Cookies: Supabase session, short-lived (10 min) redirect/plan/interval/business-type cookies, employee/client/accountant session cookies and link cookies | `src/lib/supabase/*`, `src/lib/auth-redirect.ts`, `src/lib/*-session.ts`, `src/lib/*-route-guard.ts` |
| Theme stored in browser storage | `src/app/layout.tsx` (`localStorage "theme"`) |
| App can cache pages/files on the device | `public/sw.js`, `src/components/register-sw.tsx` |
| Time-limited signed links to private files | `createSignedUrl` calls (60 s up to 7 days) |
| Row-level security separates each owner's data | `supabase/migrations/*.sql`, CLAUDE.md "Database" |
| Export: CSV (incl. QuickBooks), PDF, accountant bundle | `src/lib/csv.ts`, `src/lib/invoice-pdf.ts`, `src/components/accountant-portal/accountant-export-view.tsx` |
| No self-service account deletion | searched `src/` for `deleteUser`/account deletion: none |
| Retention: records kept while the account is open; deleting a receipt or job removes its files | the owner's decision (draft 2); `src/app/api/receipts/[id]/route.ts`, `src/lib/job-photos-server.ts`. The code itself defines no retention period |
| Deletion within 30 days on request | the owner's decision; the manual steps are in `deletion-runbook.md` |
| Staff access for support only | the owner's decision; admin area `src/app/admin`, `src/lib/admin*` |

Not claimed anywhere because the code does not support it: encryption at rest details, certifications, backups, data residency, uptime, or that data is never shared.
