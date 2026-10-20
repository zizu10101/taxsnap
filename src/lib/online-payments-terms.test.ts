import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FEE_AND_DISPUTE_WORDING,
  STRIPE_FEES,
  ONLINE_PAYMENTS_AGREE_LABEL,
  ONLINE_PAYMENTS_DISCLOSURE,
  ONLINE_PAYMENTS_DISCLOSURE_SHORT,
  TERMS_REQUIRED_CODE,
  termsDecision,
} from "./online-payments-terms.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// The fee and dispute wording as the owner supplied it - any edit has to be deliberate.
const FEE_WORDING =
  "Stripe's fee is 2.9% + CA$0.30 per domestic card payment, plus 0.8% for international cards. " +
  "Cardholders can dispute a card payment (a chargeback). Stripe charges CA$15 when a dispute is received and another CA$15 if you contest it (refunded if you win). " +
  "If you lose, the payment is taken back. " +
  "You handle disputes and refunds in your Stripe Dashboard. TaxSnap records the outcome in your books but does not handle or contest disputes or refunds, and is not responsible for them. " +
  "See Stripe's pricing page for current fees.";
const SELLER = "You are the seller. Card payments go to your own Stripe account, and Stripe is your payment processor.";
const EXPECTED = `${SELLER} ${FEE_WORDING}`;

test("the fee and dispute wording is exactly the approved text", () => {
  assert.equal(FEE_AND_DISPUTE_WORDING, FEE_WORDING);
  assert.equal(ONLINE_PAYMENTS_DISCLOSURE, EXPECTED);
  assert.equal(ONLINE_PAYMENTS_AGREE_LABEL, "I understand and agree");
});

test("the fee numbers live in one constant and the wording is built from it", () => {
  assert.deepEqual(STRIPE_FEES, {
    domesticCard: "2.9% + CA$0.30",
    internationalExtra: "0.8%",
    disputeReceived: "CA$15",
    disputeContested: "CA$15",
  });
  // No other source file spells out a Stripe fee number: they all read the constant.
  for (const f of [
    "../components/settings/online-payments-card.tsx",
    "../components/settings/online-payments-terms-dialog.tsx",
    "./faq-items.ts",
  ]) {
    assert.doesNotMatch(read(f), /2\.9%|CA\$|\$15|0\.8%/, `${f} must not repeat the fee numbers`);
  }
  assert.match(read("./faq-items.ts"), /\$\{FEE_AND_DISPUTE_WORDING\}/);
});

test("the old US-dollar wording is gone everywhere in the app", () => {
  for (const f of [
    "./online-payments-terms.ts",
    "./faq-items.ts",
    "../components/settings/online-payments-card.tsx",
    "../components/settings/online-payments-terms-dialog.tsx",
  ]) {
    // Any bare "$" fee amount (not CA$) is the old wording.
    assert.doesNotMatch(read(f), /(?<!CA)\$0\.30|(?<!CA)\$15 fee/, f);
  }
});

test("the short wording on the card keeps every point: seller, fee, chargeback, both CA$15 fees, win/lose, Dashboard, pricing page", () => {
  const short = ONLINE_PAYMENTS_DISCLOSURE_SHORT.join(" ");
  assert.equal(short, EXPECTED, "the card shows the same sentences, one per line");
  for (const point of [
    /You are the seller/,
    /Stripe is your payment processor/,
    /2\.9% \+ CA\$0\.30 per domestic card payment, plus 0\.8% for international cards/,
    /\(a chargeback\)/,
    /CA\$15 when a dispute is received and another CA\$15 if you contest it \(refunded if you win\)/,
    /If you lose, the payment is taken back/,
    /Stripe Dashboard/,
    /TaxSnap records the outcome in your books but does not handle or contest disputes or refunds, and is not responsible for them/,
    /See Stripe's pricing page for current fees/,
  ]) {
    assert.match(short, point);
  }
});

// ------------------------------------------------------------------ the server rule

test("connect/start: accepted before carries on, ticked now is recorded, otherwise refused", () => {
  assert.equal(termsDecision({ acceptedAt: "2026-10-20T00:00:00Z", acceptTerms: false }), "already");
  assert.equal(termsDecision({ acceptedAt: "2026-10-20T00:00:00Z", acceptTerms: undefined }), "already");
  assert.equal(termsDecision({ acceptedAt: null, acceptTerms: true }), "accept");
  assert.equal(termsDecision({ acceptedAt: undefined, acceptTerms: true }), "accept");
  assert.equal(termsDecision({ acceptedAt: null, acceptTerms: false }), "required");
  assert.equal(termsDecision({ acceptedAt: null, acceptTerms: undefined }), "required");
  assert.equal(termsDecision({ acceptedAt: "", acceptTerms: undefined }), "required");
});

test("only a real `true` counts as ticking the box", () => {
  for (const sneaky of ["true", 1, "on", {}, [], "yes"]) {
    assert.equal(termsDecision({ acceptedAt: null, acceptTerms: sneaky }), "required", String(sneaky));
  }
});

test("the start route refuses without acceptance BEFORE any Stripe call, and stores the time once", () => {
  const src = read("../app/api/stripe/connect/start/route.ts");
  assert.match(src, /online_payments_terms_accepted_at/);
  assert.match(src, /termsDecision\(/);
  assert.match(src, /decision === "required"/);
  assert.match(src, /code: TERMS_REQUIRED_CODE \}, \{ status: 403 \}/);
  assert.ok(src.indexOf('decision === "required"') < src.indexOf("getConnectStripe()"), "refused before the Stripe client exists");
  assert.ok(src.indexOf('decision === "required"') < src.indexOf("createConnectedAccount("));
  assert.match(src, /\.is\("online_payments_terms_accepted_at", null\)/, "the first acceptance time is never overwritten");
  assert.equal(TERMS_REQUIRED_CODE, "TERMS_REQUIRED");
});

// ------------------------------------------------------------------ the dialog

test("the dialog shows the disclosure, starts unticked, and disables Connect until ticked", () => {
  const dialog = read("../components/settings/online-payments-terms-dialog.tsx");
  assert.match(dialog, /useState\(false\)/, "unticked by default");
  assert.match(dialog, /\{ONLINE_PAYMENTS_DISCLOSURE\}/);
  assert.match(dialog, /ONLINE_PAYMENTS_AGREE_LABEL/);
  assert.match(dialog, /disabled=\{!agreed \|\| loading\}/);
  assert.match(dialog, /setAgreed\(false\)/, "reset when it closes");
  assert.match(dialog, /Connect Stripe/);
  assert.doesNotMatch(dialog, /defaultChecked|useState\(true\)/);
});

test("the card opens the dialog until the terms are accepted, and only then calls the route with accept_terms", () => {
  const card = read("../components/settings/online-payments-card.tsx");
  assert.match(card, /termsAcceptedAt \? connect\(false\) : setDialogOpen\(true\)/);
  assert.match(card, /onConfirm=\{\(\) => connect\(true\)\}/);
  assert.match(card, /accept_terms: acceptTerms/);
  assert.match(card, /ONLINE_PAYMENTS_DISCLOSURE_SHORT\.map/);
  assert.match(read("../app/(app)/dashboard/settings/page.tsx"), /termsAcceptedAt=\{profile\?\.online_payments_terms_accepted_at/);
});

test("nothing but the dialog's own confirm can send accept_terms: true", () => {
  const card = read("../components/settings/online-payments-card.tsx");
  assert.equal((card.match(/connect\(true\)/g) ?? []).length, 1);
});

// ------------------------------------------------------------------ FAQ, migration, draft

test("the FAQ answers 'Can clients dispute card payments?' with the same wording", () => {
  const src = read("./faq-items.ts");
  const at = src.indexOf('question: "Can clients dispute card payments?"');
  assert.ok(at > 0);
  const entry = src.slice(at, src.indexOf("\n  },", at));
  assert.match(entry, /Yes\./);
  assert.match(entry, /you are the seller/);
  assert.match(entry, /\$\{FEE_AND_DISPUTE_WORDING\}/);
  assert.match(entry, /TaxSnap adds no fee/);
  assert.doesNotMatch(entry, /home: true/, "it lives on /faq only");
});

test("0068 adds the timestamp, nothing is backfilled, and there is a rollback", () => {
  const up = read("../../supabase/migrations/0068_online_payments_terms.sql");
  assert.match(up, /add column if not exists online_payments_terms_accepted_at timestamptz/);
  assert.doesNotMatch(up, /\bupdate\b\s+public\.profiles/i, "no backfill");
  const down = read("../../supabase/rollbacks/0068_online_payments_terms_rollback.sql");
  assert.match(down, /drop column if exists online_payments_terms_accepted_at/);
  assert.match(read("./database.types.ts"), /online_payments_terms_accepted_at: string \| null/);
});

test("the Terms text is a clearly marked draft, kept out of anything the app serves", () => {
  const draft = read("../../docs/legal-drafts/online-payments-terms-DRAFT.md");
  assert.match(draft, /^# DRAFT - FOR LAWYER REVIEW - NOT PUBLISHED/);
  assert.match(draft, /## Online payments/);
  assert.match(draft, /\[Lawyer:/);
  assert.doesNotMatch(read("../../.gitignore") + "", /legal-drafts/, "it is meant to be committed for review");
});

test("the draft terms carry the same fee and dispute wording and numbers as the app", () => {
  const draft = read("../../docs/legal-drafts/online-payments-terms-DRAFT.md").replace(/\s*\r?\n>?\s*/g, " ");
  // The quoted in-app summary is the full disclosure, word for word.
  assert.ok(draft.includes(EXPECTED), "the quoted summary matches what users tick");
  // Clauses 4 and 5 use the same figures, read from the one constant.
  for (const figure of [STRIPE_FEES.domesticCard, STRIPE_FEES.internationalExtra, STRIPE_FEES.disputeReceived, STRIPE_FEES.disputeContested]) {
    assert.ok(draft.includes(figure), `draft mentions ${figure}`);
  }
  assert.match(draft, /another CA\$15 if you contest it \(refunded if you win\)/);
  assert.match(draft, /See Stripe's pricing page for current fees/);
  assert.doesNotMatch(draft, /\$0\.30 per domestic card, with higher rates|dispute fee \(at the date of writing, \$15\)/, "the old wording is gone");
});
