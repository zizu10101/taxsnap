import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page";
import { LEGAL_COMPANY, LEGAL_CONTACT_EMAIL, PRIVACY_LAST_UPDATED, PRIVACY_VERSION } from "@/lib/legal-versions";

// Counsel reviewed this page on 2026-10-22, except the Sentry and Gemini paragraphs (section 3), which
// await review. Indexed and in the sitemap (a test pins both).
export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy — TaxSnap",
  description: "How TaxSnap handles your information.",
  path: "/privacy",
});

const mail = (
  <a className="underline" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>
    {LEGAL_CONTACT_EMAIL}
  </a>
);

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" version={PRIVACY_VERSION} updated={PRIVACY_LAST_UPDATED}>
      <p>
        {LEGAL_COMPANY} of Ontario, Canada ({"“"}we{"”"}) operates TaxSnap. This policy explains what information
        TaxSnap collects, why, who else handles it, and your choices. We aim to follow Canada{"’"}s Personal Information
        Protection and Electronic Documents Act (PIPEDA) and Ontario law. Privacy contact: {mail}.
      </p>

      <LegalSection title="1. Who this covers">
        <p>
          Mainly the business owners who sign up. TaxSnap also holds information you enter about other people: your
          clients, your employees and your accountant. If you enter someone else{"’"}s personal information, you are
          responsible for having the right to do so. For that information we act as your service provider, and you decide
          what goes in.
        </p>
      </LegalSection>

      <LegalSection title="2. What we collect, and why">
        <LegalList
          items={[
            <span key="a"><strong>Account:</strong> your email address, and a password if you choose one (the sign-in service stores it hashed) or a Google sign-in. Plan and billing status. Used to sign you in and run your account.</span>,
            <span key="b"><strong>Business profile:</strong> business name, address, phone, email, logo, province, optional HST/business number, and your settings. Shown on your invoices and estimates.</span>,
            <span key="c"><strong>Receipts and expenses:</strong> the receipt photo you upload and the details read from it (merchant, date, amounts, tax, category, items), plus anything you type. Used to keep your expenses and HST estimates.</span>,
            <span key="d"><strong>Clients:</strong> names, email, phone and address you enter, and the invoices, estimates and payments you record for them. Used to produce and send your documents.</span>,
            <span key="e"><strong>Employees and hours:</strong> names, pay rates, hours and clock-in/out times you or your employees enter, and an employee PIN (stored hashed, not readable). Used for job costing.</span>,
            <span key="f"><strong>Jobs and site photos:</strong> job names and the photos you add. Photos are re-encoded in your browser before upload, which removes location and other camera data.</span>,
            <span key="g"><strong>Payments:</strong> payments you record, and, if you use Online payments, the payment details Stripe reports to us (amount, date, status, Stripe{"’"}s fee, refund and dispute outcomes). We do not receive card numbers. When a client pays an invoice online, we also receive the payer{"’"}s name and email entered at checkout, used only to send a receipt.</span>,
            <span key="h"><strong>Estimate signatures:</strong> when a client signs an estimate online we store the name they typed, the time and their IP address.</span>,
            <span key="i"><strong>Technical data:</strong> sign-in sessions, and IP addresses used for security and rate limiting (for example sign-in attempts, checkout attempts, which are stored hashed). Our hosting provider also keeps standard server logs.</span>,
            <span key="j"><strong>Messages:</strong> if you email us, we keep what you send. If you send us feedback or contact support, we use your message and your account email to reply and to improve the product.</span>,
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Who else receives it">
        <p>We use these service providers. Each receives only what it needs for its job:</p>
        <LegalList
          items={[
            <span key="s"><strong>Supabase</strong> (database, sign-in, file storage): holds all of the account data above, including receipt images, logos and site photos, in private storage.</span>,
            <span key="v"><strong>Vercel</strong> (hosting): runs the app and handles requests, so it processes everything you send to TaxSnap in transit, and keeps server logs.</span>,
            <span key="g"><strong>Google (Gemini AI)</strong>: when you scan a receipt, the receipt image is sent to Google{"’"}s Gemini service to read it, and the extracted fields come back. We do not send your name or account details with the image. When you scan a receipt, the image is sent to Google{"’"}s Gemini API under Google{"’"}s paid service terms. Under those terms, Google does not use submitted content to improve its products. Google may keep request logs for a limited period to detect abuse and meet legal requirements, and may process data in any country where it operates.</span>,
            <span key="st"><strong>Stripe</strong>: processes TaxSnap subscription payments (your billing details are with Stripe) and, if you use Online payments, your clients{"’"} card payments to your own Stripe account. Stripe has its own privacy policy.</span>,
            <span key="sn"><strong>Sentry</strong> (error monitoring): receives technical error reports, as described in the paragraph below.</span>,
            <span key="r"><strong>Resend</strong> (email): delivers emails TaxSnap sends: invoices and estimates to your clients, payment receipts, and notices to you. It sees the recipient, subject and content of those emails.</span>,
          ]}
        />
        <p>
          We use Sentry (data stored in the United States) to detect and fix errors in the app. Error reports are limited to technical details and are filtered to remove request contents, cookies and recognizable personal identifiers such as email addresses and phone numbers. Rarely, other text that appears in an error message could remain in a report.
        </p>
        <p>
          Beyond these providers, we share information only where you direct it (for example, when you send an invoice, share a
          link, or give an employee, client or accountant access), where required by law, or in a sale or reorganisation of
          the business. TaxSnap staff may access account data only to provide support or to maintain the service. We do not sell personal information. TaxSnap shows no advertising.
        </p>
      </LegalSection>

      <LegalSection title="4. People you give access to">
        <p>
          You can give employees, clients and your accountant their own sign-in (a link and PIN). They see only the limited
          information built for them (for example an employee sees their own hours, a client sees their own invoices).
          Invoices and estimates you share by link can be opened by anyone who has the link.
        </p>
      </LegalSection>

      <LegalSection title="5. Where it is stored">
        <p>
          Our database and file storage are hosted by Supabase in the United States (Oregon). The app runs on Vercel,
          which may process requests in the United States, Canada or other regions. Providers (including Google and Stripe) may process data outside Canada, so it may be subject
          to the laws of other countries.
        </p>
      </LegalSection>

      <LegalSection title="6. How long we keep it">
        <p>
          We keep your records while your account is open. When you delete an individual receipt, its photo is removed
          from storage as well, and deleting a job also removes its site photos. If you ask us to delete your account, we
          will delete your account and data within 30 days of your request, except billing records that we are required
          by law to keep. Information in provider backups and logs may remain for a limited time after that. Export what you
          need before you ask, because deletion cannot be undone.
        </p>
      </LegalSection>

      <LegalSection title="7. Your choices and rights">
        <LegalList
          items={[
            "Access and correction: you can see and edit your data in the app. You can ask us for a copy of your personal information or to correct it.",
            "Export: expenses and reports can be downloaded as CSV (including a QuickBooks format), invoices as PDF, and Pro accounts can download an accountant export bundle.",
            "Deletion: you can delete individual receipts, invoices, clients, jobs and photos in the app. There is no self-service “Delete my account” button yet; email us and we will delete your account and data within 30 days (export first).",
            "Withdrawing consent and complaints: you may withdraw consent for optional uses (for example by not using Online payments or AI scanning), or raise a concern with us. You may also complain to the Office of the Privacy Commissioner of Canada.",
          ]}
        />
        <p>Send requests to {mail}. We may need to confirm who you are first.</p>
      </LegalSection>

      <LegalSection title="8. Security">
        <p>
          Data is sent over HTTPS. Sign-in is handled by Supabase, each owner{"’"}s data is separated by row-level security rules
          in the database, files are in private storage and opened with time-limited links, and employee, client and
          accountant PINs are stored hashed with lockouts after repeated wrong tries. No system is perfectly secure, and we
          cannot guarantee that information will never be accessed without permission. Keep your own sign-in details and PINs
          private.
        </p>
      </LegalSection>

      <LegalSection title="9. Cookies and tracking">
        <p>
          TaxSnap uses only the cookies and browser storage it needs to work: sign-in session cookies, short-lived cookies
          that remember where you were heading or the plan or business type you chose while signing up, sign-in cookies for
          employee, client and accountant access (plus a longer-lived cookie that remembers their sign-in link), and your light/dark theme choice in browser storage. The app can also
          cache its pages and files on your device so it loads faster. We do not use advertising or analytics cookies or
          trackers in the app.
        </p>
      </LegalSection>

      <LegalSection title="10. Children">
        <p>TaxSnap is for businesses and is not for anyone under 18. We do not knowingly collect information from children.</p>
      </LegalSection>

      <LegalSection title="11. If something goes wrong">
        <p>
          If we learn of a breach of security safeguards that creates a real risk of significant harm, we will tell the
          people affected and the Privacy Commissioner of Canada as the law requires, and keep a record of it.
        </p>
      </LegalSection>

      <LegalSection title="12. Changes">
        <p>
          We may update this policy. The date and version at the top show the current text, and we will tell you in the app
          or by email about material changes.
        </p>
      </LegalSection>

      <LegalSection title="13. Contact">
        <p>
          {LEGAL_COMPANY}, Ontario, Canada. Privacy requests and questions: {mail}
        </p>
      </LegalSection>
    </LegalPage>
  );
}
