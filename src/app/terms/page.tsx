import type { Metadata } from "next";
import Link from "next/link";
import { LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page";
import { LEGAL_COMPANY, LEGAL_CONTACT_EMAIL, TERMS_LAST_UPDATED, TERMS_VERSION } from "@/lib/legal-versions";
import { BILLING_CHANGE_POLICY, PRICING_PLANS, formatCadPrice } from "@/lib/pricing-plans";
import {
  DISPUTE_SENTENCES,
  FEE_EXPENSE_HST_SENTENCE,
  FEE_SENTENCE,
  PRICING_SENTENCE,
  RESPONSIBILITY_SENTENCE,
} from "@/lib/online-payments-terms";

// DRAFT for a lawyer to review. Not indexed and not in the sitemap until that sign-off
// (a test pins both). Facts come from the code; open questions are in docs/legal-drafts/lawyer-brief.md.
export const metadata: Metadata = {
  title: "Terms of Service — TaxSnap",
  description: "The terms for using TaxSnap.",
  robots: { index: false },
};

const pro = PRICING_PLANS[0];

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" version={TERMS_VERSION} updated={TERMS_LAST_UPDATED}>
      <p>
        These terms are between you and {LEGAL_COMPANY} of Ontario, Canada ({"“"}we{"”"}, {"“"}us{"”"}), who
        operate TaxSnap. By creating an account or using TaxSnap you agree to them. If you do not agree, do not use TaxSnap.
        Questions: <a className="underline" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>

      <LegalSection title="1. What TaxSnap is">
        <p>
          TaxSnap is a web app for self-employed people and small businesses in Canada. It lets you scan receipts and
          keep expenses (receipt data is read by an AI service), estimate HST, send invoices and estimates to your clients,
          record payments, track jobs, hours and site photos, and produce reports. Some features let other people
          you choose (your employees, your clients, your accountant) view limited information through their own links.
          Optionally, you can let your clients pay an invoice by card online through Stripe (see section 11).
        </p>
      </LegalSection>

      <LegalSection title="2. Not accounting, tax or legal advice">
        <p>
          TaxSnap is not an accountant, tax advisor or lawyer. Its HST figures, reports and categories are planning
          estimates, not a tax filing and not advice. Data read from receipts by AI can be wrong or
          incomplete. You are responsible for checking it, and for the accuracy of your records, your invoices, and
          every tax return or filing you make. Talk to a qualified professional about your situation.
        </p>
      </LegalSection>

      <LegalSection title="3. Your account">
        <LegalList
          items={[
            "You must be at least 18 and able to enter a contract. TaxSnap is for business use.",
            "Give accurate information and keep your sign-in details and any PINs safe. You are responsible for activity on your account, including access you give to employees, clients or an accountant.",
            "Tell us at once if you think someone else has accessed your account.",
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Free and Pro plans">
        <p>
          TaxSnap has a Free plan and a Pro plan. The Free plan has usage limits (for example on receipt scans, invoices,
          clients and jobs); the current limits are shown on our pricing page and in the app and may change. Invoices
          created on the Free plan carry a small {"“"}Created with TaxSnap{"”"} credit in the footer of the PDF, the
          online invoice page and emailed invoices. Pro removes the credit and the limits.
        </p>
        <p>
          Pro costs {formatCadPrice(pro.monthlyPrice, "monthly")} or {formatCadPrice(pro.yearlyPrice, "yearly")}, in
          Canadian dollars, plus applicable taxes. Subscriptions are billed through Stripe and renew each period until cancelled.
          You can change your billing interval or cancel at any time from the billing page. {BILLING_CHANGE_POLICY}
        </p>
        <p>
          Payments for a billing period already started are not refunded, including a partly used period, unless we
          decide otherwise in a particular case or the law requires it. The exception is a first annual Pro purchase:
          you can ask for a full refund within 14 days of that purchase by contacting us.
        </p>
      </LegalSection>

      <LegalSection title="5. Your content">
        <p>
          You keep ownership of what you put into TaxSnap (receipts and photos, expenses, client details, invoices and so on).
          You give us permission to store, process and display it, and to send it to the service providers named in our{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>, only as needed to run TaxSnap for you. TaxSnap staff may access
          account data only to provide support or to maintain the service. You
          promise that you have the right to upload it, including any personal information about your clients and
          employees that you enter.
        </p>
      </LegalSection>

      <LegalSection title="6. Acceptable use">
        <LegalList
          items={[
            "Do not use TaxSnap for anything unlawful, fraudulent or misleading, including false invoices or records.",
            "Do not try to access other people's data, probe or disrupt the service, or get around limits, sign-in or security.",
            "Do not upload malware or content you have no right to upload.",
            "Do not resell TaxSnap or use it to build a competing service.",
          ]}
        />
        <p>We may suspend or limit an account that breaks these rules.</p>
      </LegalSection>

      <LegalSection title="7. Availability and changes to the service">
        <p>
          We work to keep TaxSnap available but do not promise it will always be uninterrupted or error-free. It depends on
          other providers (hosting, database, email, AI and payments). We may change, add or remove features, including
          plan limits, at any time.
        </p>
      </LegalSection>

      <LegalSection title="8. Limitation of liability">
        <p>
          TaxSnap is provided {"“"}as is{"”"}. To the extent the law allows, we are not liable for indirect or
          consequential losses, lost profits or revenue, lost data, or penalties, interest or reassessments from any tax
          authority arising from your use of TaxSnap, and our total liability to you for any claim is limited to the
          greater of the amount you paid us for TaxSnap in the 12 months before the claim and CA$100. Nothing here limits liability that cannot be
          limited by law. [Lawyer: confirm the cap and exclusions.]
        </p>
      </LegalSection>

      <LegalSection title="9. Termination">
        <p>
          You can stop using TaxSnap at any time and cancel a paid plan as described above. We can suspend or end your
          access if you break these terms, if required by law, or if we stop offering the service; where reasonable we
          will tell you first. To ask us to delete your account and data, email{" "}
          <a className="underline" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>; see the Privacy Policy
          for what happens to your data. Export what you need before you ask us to delete it, because deletion cannot
          be undone.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes to these terms">
        <p>
          We may update these terms. The {"“"}Last updated{"”"} date and version at the top show the current text. If a
          change is material we will tell you in the app or by email before it applies. If you keep using TaxSnap after
          that, you accept the new terms.
        </p>
      </LegalSection>

      <LegalSection title="11. Online payments" id="online-payments">
        <p>
          <strong>What it is.</strong> Online payments lets you invoice a client and let them pay that invoice by card
          through a payment page provided by Stripe, Inc. and its affiliates ({"“"}Stripe{"”"}). It is optional.
        </p>
        <p>
          <strong>You are the seller.</strong> When a client pays you through Online payments, you, not TaxSnap, are the
          seller of the goods or services, and the payment is made to your own Stripe account. Stripe, not TaxSnap, is your
          payment processor. TaxSnap does not receive, hold or transmit your clients{"’"} funds, and is not a bank,
          payment processor or money services business.
        </p>
        <p>
          <strong>Your agreement with Stripe.</strong> To use Online payments you must open (or connect) a Stripe account and
          accept Stripe{"’"}s terms. Those terms are between you and Stripe. Stripe may decline, hold, limit or close
          your account or any payment, and TaxSnap has no control over those decisions.
        </p>
        <p>
          <strong>Fees.</strong> {FEE_SENTENCE} {PRICING_SENTENCE} TaxSnap does not add a fee to Online payments.
        </p>
        <p>
          <strong>Disputes, chargebacks and refunds.</strong> {DISPUTE_SENTENCES} {RESPONSIBILITY_SENTENCE} Refunds are
          issued by you. You are solely responsible for responding to disputes, for issuing refunds, and for any amounts,
          fees or losses that result. TaxSnap has no authority to decide a dispute or a refund. The one exception is a
          client paying an invoice more than once: TaxSnap records only up to the balance owing and automatically refunds
          the extra to the client{"’"}s card on your Stripe account.
        </p>
        <p>
          <strong>Records and taxes.</strong> TaxSnap records a successful online payment on the invoice as a payment, and
          mirrors refunds and lost disputes that you handle in Stripe as negative payments, so that your invoice balances and
          HST estimates follow. {FEE_EXPENSE_HST_SENTENCE} The records and estimates in TaxSnap are a planning aid, not tax
          advice and not a filing; you remain responsible for your own tax reporting.
        </p>
        <p>
          <strong>Your clients{"’"} information.</strong> When your client pays, Stripe collects their payment details and
          handles them under Stripe{"’"}s own terms and privacy policy. TaxSnap does not receive card numbers. TaxSnap may
          receive the client{"’"}s email address entered at checkout, and uses it only to email a payment receipt.
        </p>
        <p>
          <strong>Acceptable use.</strong> Use Online payments only for lawful goods and services that Stripe permits. You
          are responsible for what you invoice and for the accuracy of the invoice.
        </p>
        <p>
          <strong>Availability.</strong> Online payments is offered for Canadian businesses, in Canadian dollars, and
          depends on Stripe. We may change, suspend or end it at any time, including if Stripe{"’"}s terms or fees change.
          Ending it does not affect payments already made.
        </p>
        <p>
          <strong>Acceptance record.</strong> Before connecting Stripe you are shown a summary of these points and must tick
          {" “"}I understand and agree{"”"}. TaxSnap records the time you accepted.
        </p>
      </LegalSection>

      <LegalSection title="12. Governing law">
        <p>
          These terms are governed by the laws of the Province of Ontario and the federal laws of Canada that apply there.
          Disputes are for the courts of Ontario. [Lawyer: confirm forum wording.]
        </p>
      </LegalSection>

      <LegalSection title="13. Contact">
        <p>
          {LEGAL_COMPANY}, Ontario, Canada.{" "}
          <a className="underline" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
