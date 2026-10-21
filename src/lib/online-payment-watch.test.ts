import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OWNER_WATCH_WINDOW_MS,
  OWNER_IDLE_POLL_MS,
  OWNER_IDLE_WINDOW_MS,
  awaitsPayment,
  shouldRefreshOwnerView,
  PUBLIC_POLL_MAX_MS,
  PUBLIC_POLL_MS,
  OWNER_POLL_MS,
  confirmPhase,
  mayWatchOnlinePayment,
  shouldWatchOnlinePayment,
  showPayNow,
} from "./online-payment-watch.ts";
import {
  COPY_LINK_LABEL,
  COPY_PAYMENT_LINK_LABEL,
  ENABLE_ONLINE_PAYMENTS_HINT,
  PAY_LINK_COPIED_TOAST,
  PAY_LINK_LINE,
  copyLinkLabel,
  copyLinkToast,
  payLinkState,
} from "./payment-link-wording.ts";
import { sendMenu } from "./line-format.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ------------------------------------------------------------------ the client's page

test("polling cadence: every 2 s for up to 30 s", () => {
  assert.equal(PUBLIC_POLL_MS, 2000);
  assert.equal(PUBLIC_POLL_MAX_MS, 30000);
});

test("confirmation phases: confirming, then received once paid, or processing after 30 s", () => {
  assert.equal(confirmPhase({ justPaid: false, settled: false, elapsedMs: 0 }), "none");
  assert.equal(confirmPhase({ justPaid: true, settled: false, elapsedMs: 0 }), "confirming");
  assert.equal(confirmPhase({ justPaid: true, settled: false, elapsedMs: 29999 }), "confirming");
  assert.equal(confirmPhase({ justPaid: true, settled: false, elapsedMs: 30000 }), "processing");
  assert.equal(confirmPhase({ justPaid: true, settled: true, elapsedMs: 4000 }), "received");
  assert.equal(confirmPhase({ justPaid: true, settled: true, elapsedMs: 99999 }), "received", "late arrival still wins");
});

test("Pay now is never shown while a payment the client just made is not recorded", () => {
  assert.equal(showPayNow({ payable: true, justPaid: true, settled: false }), false);
  assert.equal(showPayNow({ payable: true, justPaid: false, settled: false }), true);
  assert.equal(showPayNow({ payable: false, justPaid: false, settled: false }), false);
  assert.equal(showPayNow({ payable: true, justPaid: true, settled: true }), true, "settled and still owing");
});

test("the public page uses both rules and the polling component", () => {
  const page = read("../app/invoice/[token]/page.tsx");
  assert.match(page, /<PaymentConfirmation settled=\{fullyPaid\} \/>/);
  assert.match(page, /showPayNow\(\{ payable: payable !== null, justPaid: Boolean\(justPaid\), settled: fullyPaid \}\)/);
  const comp = read("../components/public/payment-confirmation.tsx");
  assert.match(comp, /if \(settled\) return;/, "no polling once paid");
  assert.match(comp, /router\.refresh\(\)/);
  assert.match(comp, /Payment received, confirming\.\.\./);
  assert.match(comp, /Your payment is being processed\. You&apos;ll get a receipt by email\./);
  assert.match(comp, /ms >= PUBLIC_POLL_MAX_MS/);
});

// ------------------------------------------------------------------ the owner's views

const now = Date.parse("2026-10-20T12:00:00Z");
const base = {
  type: "invoice",
  status: "sent",
  online_session_opened_at: "2026-10-20T11:50:00Z",
  total_amount: 100,
  payments: [] as { amount: number }[],
};

test("the owner view polls only for a fresh online session on an unpaid invoice", () => {
  assert.equal(OWNER_POLL_MS, 5000);
  assert.equal(OWNER_WATCH_WINDOW_MS, 30 * 60 * 1000);
  assert.equal(shouldWatchOnlinePayment(base, now), true);
  assert.equal(shouldWatchOnlinePayment({ ...base, status: "partial", payments: [{ amount: 40 }] }, now), true);
});

test("it stops when paid, after 30 minutes, or when there is no online session", () => {
  assert.equal(shouldWatchOnlinePayment({ ...base, status: "paid", payments: [{ amount: 100 }] }, now), false);
  assert.equal(shouldWatchOnlinePayment({ ...base, payments: [{ amount: 100 }] }, now), false, "balance cleared");
  assert.equal(shouldWatchOnlinePayment({ ...base, online_session_opened_at: "2026-10-20T11:29:00Z" }, now), false);
  assert.equal(shouldWatchOnlinePayment({ ...base, online_session_opened_at: null }, now), false);
  assert.equal(shouldWatchOnlinePayment({ ...base, type: "estimate" }, now), false);
  assert.equal(shouldWatchOnlinePayment({ ...base, status: "draft" }, now), false);
  assert.equal(mayWatchOnlinePayment({ ...base, online_session_opened_at: null }), false);
  assert.equal(mayWatchOnlinePayment(base), true);
});

test("the hook ticks on an interval that clears itself, refreshes on focus, and uses no realtime", () => {
  const hook = read("./use-online-payment-watch.ts");
  assert.match(hook, /setInterval/);
  assert.match(hook, /clearInterval/);
  assert.match(hook, /addEventListener\("focus"/);
  assert.match(hook, /removeEventListener\("focus"/);
  assert.match(hook, /addEventListener\("visibilitychange"/);
  assert.match(hook, /shouldRefreshOwnerView\(documents, \{ now: Date\.now\(\)/, "the clock rules are checked on every tick");
  assert.match(hook, /const watching = documents\.some\(awaitsPayment\)/, "armed by status and balance, NOT by online_session_opened_at");
  assert.doesNotMatch(hook.replace(/\/\/.*$/gm, ""), /mayWatchOnlinePayment/);
  assert.doesNotMatch(hook.replace(/\/\/.*$/gm, ""), /realtime|channel\(/i);
  assert.match(read("../components/invoices/document-detail.tsx"), /useOnlinePaymentWatch\(watched\)/);
  assert.match(read("../components/invoices/document-list.tsx"), /useOnlinePaymentWatch\(documents\)/);
});

// ------------------------------------------------------------------ copy-link wording

test("link state: active only for an invoice with a balance and Online payments on", () => {
  const inv = { type: "invoice", total: 100, paid: 0 };
  assert.equal(payLinkState({ ...inv, onlinePaymentsActive: true }), "active");
  assert.equal(payLinkState({ ...inv, onlinePaymentsActive: false }), "inactive");
  assert.equal(payLinkState({ ...inv, paid: 100, onlinePaymentsActive: true }), null, "nothing owing");
  assert.equal(payLinkState({ ...inv, type: "estimate", onlinePaymentsActive: true }), null);
});

test("wording per state", () => {
  assert.equal(copyLinkLabel("active"), "Copy payment link");
  assert.equal(copyLinkLabel("inactive"), "Copy link");
  assert.equal(copyLinkLabel(null), "Copy link");
  assert.equal(COPY_PAYMENT_LINK_LABEL, "Copy payment link");
  assert.equal(COPY_LINK_LABEL, "Copy link");
  assert.equal(PAY_LINK_LINE, "Your client can view this invoice and pay by card from this link.");
  assert.equal(copyLinkToast("invoice", "active"), "Link copied. Your client can pay online with it.");
  assert.equal(PAY_LINK_COPIED_TOAST, "Link copied. Your client can pay online with it.");
  assert.equal(copyLinkToast("invoice", "inactive"), "Invoice link copied to clipboard");
  assert.equal(copyLinkToast("invoice", null), "Invoice link copied to clipboard");
  assert.equal(copyLinkToast("estimate", null), "Signature link copied to clipboard");
  assert.equal(ENABLE_ONLINE_PAYMENTS_HINT, "Turn on online payments so clients can pay from this link.");
});

test("the Send menu uses the state's label and keeps the rest", () => {
  const labels = (payLink?: "active" | "inactive" | null) =>
    sendMenu({ clientEmail: "a@b.ca", payLink }).options.map((o) => o.label);
  assert.deepEqual(labels("active"), ["Email to client", "Copy payment link", "Download PDF"]);
  assert.deepEqual(labels("inactive"), ["Email to client", "Copy link", "Download PDF"]);
  assert.deepEqual(labels(undefined), ["Email to client", "Copy link", "Download PDF"]);
});

test("the menu shows the line or the Settings hint, and the Settings card has the anchor", () => {
  const menu = read("../components/invoices/send-document-menu.tsx");
  assert.match(menu, /payLink === "active" &&[\s\S]*PAY_LINK_LINE/);
  assert.match(menu, /payLink === "inactive"[\s\S]*ONLINE_PAYMENTS_SETTINGS_HREF[\s\S]*ENABLE_ONLINE_PAYMENTS_HINT/);
  assert.match(read("../components/settings/online-payments-card.tsx"), /id="online-payments"/);
  assert.match(
    read("../app/(app)/dashboard/invoices/[id]/page.tsx"),
    /onlinePaymentsActive=\{profile\?\.stripe_connect_status === "active"/,
  );
});

test("no plan names, prices or caps in any of this text", () => {
  const text = read("./payment-link-wording.ts") + read("../components/public/payment-confirmation.tsx");
  assert.doesNotMatch(text.replace(/\/\/.*$/gm, ""), /\bPro\b|\bFree\b|\$\d|\bplan\b|\blimit\b|\bcap\b/i);
});

// ------------------------------------------------------------------ the owner's page was opened BEFORE the client paid

test("REGRESSION: an invoice drawn with no online session yet is still watched (the old rule never started)", () => {
  const justSent = { ...base, online_session_opened_at: null }; // the props the page had when the owner opened it
  assert.equal(mayWatchOnlinePayment(justSent), false, "the old arming rule: no timer, no focus listener, nothing");
  assert.equal(awaitsPayment(justSent), true, "the new one: it is sent and owes a balance");
  assert.equal(awaitsPayment({ ...justSent, status: "partial", payments: [{ amount: 40 }] }), true);
  assert.equal(awaitsPayment({ ...justSent, status: "draft" }), false);
  assert.equal(awaitsPayment({ ...justSent, status: "paid", payments: [{ amount: 100 }] }), false);
  assert.equal(awaitsPayment({ ...justSent, payments: [{ amount: 100 }] }), false);
  assert.equal(awaitsPayment({ ...justSent, type: "estimate" }), false);
});

test("a session opened 1 minute ago with a balance owing refreshes every 5 s", () => {
  const doc = { ...base, online_session_opened_at: new Date(now - 60_000).toISOString() };
  assert.equal(shouldWatchOnlinePayment(doc, now), true);
  const t = (sinceMs: number) => ({ now, armedAt: now - 120_000, lastRefreshAt: now - sinceMs });
  assert.equal(shouldRefreshOwnerView([doc], t(OWNER_POLL_MS - 1)), false);
  assert.equal(shouldRefreshOwnerView([doc], t(OWNER_POLL_MS)), true);
});

test("no session yet: a slow refresh every 15 s, for 30 minutes after the page was opened or returned to", () => {
  const doc = { ...base, online_session_opened_at: null };
  assert.equal(OWNER_IDLE_POLL_MS, 15000);
  assert.equal(OWNER_IDLE_WINDOW_MS, 30 * 60 * 1000);
  const t = (sinceMs: number, armedAgoMs = 60_000) => ({ now, armedAt: now - armedAgoMs, lastRefreshAt: now - sinceMs });
  assert.equal(shouldRefreshOwnerView([doc], t(5000)), false, "not every 5 s");
  assert.equal(shouldRefreshOwnerView([doc], t(OWNER_IDLE_POLL_MS)), true);
  assert.equal(shouldRefreshOwnerView([doc], t(OWNER_IDLE_POLL_MS, OWNER_IDLE_WINDOW_MS + 1)), false, "an abandoned tab gives up");
});

test("a session opened while the page was already open switches the page to the fast rate", () => {
  const before = { ...base, online_session_opened_at: null };
  const after = { ...before, online_session_opened_at: new Date(now - 10_000).toISOString() }; // props after the next refresh
  const t = { now, armedAt: now - 60_000, lastRefreshAt: now - 6000 };
  assert.equal(shouldRefreshOwnerView([before], t), false);
  assert.equal(shouldRefreshOwnerView([after], t), true);
});

test("paid, draft and estimate pages are never polled", () => {
  const t = { now, armedAt: now - 1000, lastRefreshAt: now - 60_000 };
  assert.equal(shouldRefreshOwnerView([{ ...base, status: "paid", payments: [{ amount: 100 }] }], t), false);
  assert.equal(shouldRefreshOwnerView([{ ...base, status: "draft" }], t), false);
  assert.equal(shouldRefreshOwnerView([{ ...base, type: "estimate" }], t), false);
});

test("every new Checkout Session restamps online_session_opened_at (the watch window follows the latest attempt)", () => {
  const route = read("../app/api/public/invoice/[token]/checkout/route.ts");
  assert.match(route, /update\(\{ online_session_opened_at: now\.toISOString\(\) \}\)\.eq\("id", doc\.id\)/);
  assert.doesNotMatch(route, /\.is\("online_session_opened_at", null\)/);
});
