# DRAFT - FOR LAWYER REVIEW - NOT PUBLISHED, NOT LEGAL ADVICE

Proposed "Online payments" section for the TaxSnap Terms of Service.

**Where it goes:** the repository has no Terms of Service page or file yet (no `/terms` route, no footer
or sign-up link to one - I searched `src/`, `public/` and `marketing/`). The section below belongs in
the Terms of Service wherever that lives; if the Terms are only hosted elsewhere (a Google Doc, the
operating entity's site), add it there. If the Terms are still to be written, the natural place in this
app is a new `src/app/terms/page.tsx` linked from the landing footer (`src/app/page.tsx`) and the sign-up
form (`src/app/auth/auth-form.tsx`). Nothing in this file is served by the app.

Open points for the lawyer are in square brackets.

---

## Online payments

**1. What this is.** "Online payments" lets you invoice a client and let them pay that invoice by card
through a payment page provided by Stripe, Inc. and its affiliates ("Stripe"). It is optional.

**2. You are the seller.** When a client pays you through Online payments, you - not TaxSnap - are the
seller of the goods or services, and the payment is made to your own Stripe account. Stripe, not TaxSnap,
is your payment processor. TaxSnap does not receive, hold or transmit your clients' funds, and is not a
bank, payment processor or money services business. [Lawyer: confirm this characterisation under Canadian
payments and money-services rules, and under the Stripe Connected Account Agreement.]

**3. Your agreement with Stripe.** To use Online payments you must open (or connect) a Stripe account and
accept Stripe's terms, including the Stripe Services Agreement and the Stripe Connected Account Agreement.
Those terms are between you and Stripe. Stripe may decline, hold, limit or close your account or any
payment, and TaxSnap has no control over those decisions. [Lawyer: confirm the correct Stripe agreement
names for Canadian connected accounts.]

**4. Fees.** Stripe charges you its processing fees on each payment. At the date of writing, Stripe's fee is
2.9% + CA$0.30 per domestic card payment, plus 0.8% for international cards. See Stripe's pricing page for current
fees. TaxSnap does not add a fee to Online payments. [Lawyer: if a TaxSnap platform fee is ever added, this clause
must change first; Stripe's fees are Stripe's to change, so the text should point to Stripe's pricing page rather
than fix the numbers.]

**5. Disputes, chargebacks and refunds.** Cardholders can dispute a card payment (a chargeback). Stripe charges
CA$15 when a dispute is received and another CA$15 if you contest it (refunded if you win). If you lose, the
payment is taken back. You handle disputes and refunds in your Stripe Dashboard. TaxSnap records the outcome in your books
but does not handle or contest disputes or refunds, and is not responsible for them. Refunds are issued by you. You are solely responsible for responding to
disputes, for issuing refunds, and for any amounts, fees or losses that result. TaxSnap has no authority to decide
a dispute or a refund and is not responsible for their outcome. [Lawyer: confirm the limitation of liability and
indemnity wording here, and how it interacts with the general limitation of liability section.]

**6. Records and taxes.** TaxSnap records a successful online payment on the invoice as a payment, so that
your invoice balances and your HST estimates reflect it. Stripe's processing fee is shown for information
only and is not part of your HST totals. The records and estimates in TaxSnap are a planning aid, not tax
advice and not a filing; you remain responsible for your own tax reporting. A refund or a lost dispute made
in Stripe is mirrored in TaxSnap as a negative payment (the refund and dispute phase is built); an open dispute
changes nothing in the books until it is lost, and a double payment is recorded only up to the balance, with the extra
refunded automatically to the client's card.

**7. Clients' information.** When your client pays, Stripe collects their payment details and, as a
processor, handles them under Stripe's own privacy terms. TaxSnap does not receive card numbers. TaxSnap
may receive the client's email address entered at checkout, and uses it only to email a payment receipt.
[Lawyer: align with the Privacy Policy.]

**8. Acceptable use.** You may use Online payments only for lawful goods and services that Stripe permits
(Stripe's prohibited and restricted businesses list applies). You are responsible for what you invoice
and for the accuracy of the invoice.

**9. Availability.** Online payments is offered for Canadian businesses, in Canadian dollars, and depends
on Stripe's services. We may change, suspend or end it at any time, including if Stripe's terms or fees
change. Ending it does not affect payments already made.

**10. Acceptance record.** Before connecting Stripe you are shown a summary of points 2 to 5 and must tick
"I understand and agree". TaxSnap records the time you accepted.

---

### The summary shown in the app (for reference - this is the text users tick)

> You are the seller. Card payments go to your own Stripe account, and Stripe is your payment processor.
> Stripe's fee is 2.9% + CA$0.30 per domestic card payment, plus 0.8% for international cards. Cardholders can
> dispute a card payment (a chargeback). Stripe charges CA$15 when a dispute is received and another CA$15 if you
> contest it (refunded if you win). If you lose, the payment is taken back. You handle disputes and refunds in your
> Stripe Dashboard. TaxSnap records the outcome in your books but does not handle or contest disputes or refunds, and is not responsible for them. See Stripe's pricing
> page for current fees.
