import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  describeStripeError,
  keyPrefix,
  logStripeError,
  redactSecrets,
  shouldLogStripeStartup,
  stripeErrorCode,
} from "./stripe-error.ts";
import { connectedAccountParams } from "./connect-status.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// What a real Stripe SDK error looks like (class name in `type`, API type in `rawType`).
function stripeError(over: Record<string, unknown> = {}) {
  return Object.assign(new Error("You can only create new accounts if you've signed up for Connect."), {
    type: "StripeInvalidRequestError",
    rawType: "invalid_request_error",
    code: undefined as string | undefined,
    param: undefined as string | undefined,
    statusCode: 400,
    requestId: "req_abc123",
    ...over,
  });
}

test("a Stripe error is described by type, code, param, message and request id", () => {
  const info = describeStripeError(stripeError({ code: "account_invalid", param: "controller" }));
  assert.deepEqual(info, {
    type: "invalid_request_error",
    code: "account_invalid",
    param: "controller",
    message: "You can only create new accounts if you've signed up for Connect.",
    requestId: "req_abc123",
    statusCode: 400,
  });
});

test("an error with no Stripe code falls back to its type for the browser code", () => {
  assert.equal(stripeErrorCode(stripeError({ code: "email_invalid" })), "email_invalid");
  assert.equal(stripeErrorCode(stripeError()), "invalid_request_error");
  assert.equal(stripeErrorCode(new TypeError("boom")), "TypeError");
  assert.equal(stripeErrorCode("just a string"), "Error");
  assert.equal(stripeErrorCode(null), "Error");
});

test("the browser code is never message text", () => {
  const code = stripeErrorCode(stripeError({ code: undefined, rawType: undefined, type: "StripeAPIError" }));
  assert.equal(code, "StripeAPIError");
  assert.doesNotMatch(code, /signed up/);
});

test("keys and secrets are scrubbed from anything logged", () => {
  assert.equal(
    redactSecrets("Invalid API Key provided: sk_test_51AbCdEf and whsec_abc123XYZ and rk_live_zzz"),
    "Invalid API Key provided: [redacted] and [redacted] and [redacted]",
  );
  const info = describeStripeError(stripeError({ message: "bad key sk_live_REALSECRET1234" }));
  assert.doesNotMatch(info.message, /REALSECRET/);
});

test("the log line has the five identifying fields and no secrets or bodies", () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    logStripeError(
      "connect/start create-account",
      stripeError({ code: "account_invalid", param: "country", message: "bad sk_test_SECRETVALUE9 request" }),
    );
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.match(line, /^\[stripe-error\] connect\/start create-account /);
  assert.match(line, /type=invalid_request_error/);
  assert.match(line, /code=account_invalid/);
  assert.match(line, /param=country/);
  assert.match(line, /requestId=req_abc123/);
  assert.match(line, /message="/);
  assert.doesNotMatch(line, /SECRETVALUE/);
});

test("missing fields log as dashes, and a plain Error still logs", () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    logStripeError("x", new Error("plain"));
  } finally {
    console.error = original;
  }
  assert.match(lines[0], /type=Error code=- param=- status=- requestId=-/);
});

// ------------------------------------------------------------------ wiring

test("every Connect route and the webhook log the Stripe error and return only its code", () => {
  for (const f of [
    "../app/api/stripe/connect/start/route.ts",
    "../app/api/stripe/connect/refresh/route.ts",
    "../app/api/stripe/connect/return/route.ts",
    "../app/api/stripe/connect-webhook/route.ts",
    "../app/api/public/invoice/[token]/checkout/route.ts",
  ]) {
    const src = read(f);
    assert.match(src, /logStripeError\(/, f);
    assert.match(src, /stripeErrorCode\(err\)/, f);
    // Nothing logs the raw message, the key, or a request body.
    assert.doesNotMatch(src, /console\.error\([^)]*err\.message/, f);
    assert.doesNotMatch(src, /STRIPE_SECRET_KEY[^;\n]*console|console[^;\n]*STRIPE_SECRET_KEY/, f);
  }
});

test("JSON error responses carry `code` but never the Stripe message", () => {
  const start = read("../app/api/stripe/connect/start/route.ts");
  assert.match(start, /error: "Could not reach Stripe\. Please try again\.", code: stripeErrorCode\(err\)/);
  assert.doesNotMatch(start, /error: err\b|error: String\(err|message: err/);
  const hook = read("../app/api/stripe/connect-webhook/route.ts");
  assert.match(hook, /error: "Processing failed", code: stripeErrorCode\(err\)/);
  assert.match(hook, /error: "Invalid signature", code: stripeErrorCode\(err\)/);
});

test("the start route says which Stripe step failed", () => {
  const start = read("../app/api/stripe/connect/start/route.ts");
  assert.match(start, /let step = "create-account"/);
  assert.match(start, /step = "create-onboarding-link"/);
  assert.match(start, /logStripeError\(`connect\/start \$\{step\}`, err\)/);
});

test("refresh and return pass the code to Settings, which shows it", () => {
  assert.match(read("../app/api/stripe/connect/refresh/route.ts"), /settings\("error", stripeErrorCode\(err\)\)/);
  assert.match(read("../app/api/stripe/connect/return/route.ts"), /settings\("error", stripeErrorCode\(err\)\)/);
  assert.match(read("../components/settings/online-payments-card.tsx"), /\(code: \$\{returnCode\}\)/);
  assert.match(read("../app/(app)/dashboard/settings/page.tsx"), /returnCode=\{stripeCode/);
});

// ------------------------------------------------------------------ dev startup log

test("the startup log runs in development only, with a key", () => {
  assert.equal(shouldLogStripeStartup({ NODE_ENV: "development", NEXT_RUNTIME: "nodejs" }, "sk_test_x"), true);
  assert.equal(shouldLogStripeStartup({ NODE_ENV: "production", NEXT_RUNTIME: "nodejs" }, "sk_test_x"), false);
  assert.equal(shouldLogStripeStartup({ NODE_ENV: "test" }, "sk_test_x"), false);
  assert.equal(shouldLogStripeStartup({ NODE_ENV: "development", NEXT_RUNTIME: "edge" }, "sk_test_x"), false);
  assert.equal(shouldLogStripeStartup({ NODE_ENV: "development" }, undefined), false);
  assert.equal(shouldLogStripeStartup({ NODE_ENV: "development" }, ""), false);
});

test("only the first 7 characters of the key are ever printed", () => {
  assert.equal(keyPrefix("sk_test_51ABCDEFSECRET"), "sk_test");
  assert.equal(keyPrefix("sk_live_51ABCDEFSECRET"), "sk_live");
  const src = read("./stripe-startup.ts");
  assert.match(src, /keyPrefix\(key!\)/);
  assert.doesNotMatch(src, /\$\{key!?\}/, "the full key is never interpolated into a log line");
  for (const line of src.split("\n").filter((l) => /console\.|logStripeError\(/.test(l))) {
    assert.doesNotMatch(line, /\bkey!?\s*[,)]/, `log call mentions the key: ${line.trim()}`);
  }
  assert.match(src, /accounts\.retrieveCurrent\(\)/);
  assert.match(src, /account\.id/);
});

test("instrumentation calls the startup log only in the Node runtime", () => {
  const src = read("../instrumentation.ts");
  assert.match(src, /NEXT_RUNTIME === "nodejs"/);
  assert.match(src, /logStripeStartup\(\)/);
});

// ------------------------------------------------------------------ the parameters themselves

test("account creation uses the documented Standard mapping, Canada, both capabilities", () => {
  const params = connectedAccountParams({ userId: "u", email: null, businessName: null });
  // Stripe's controller-properties guide: Standard = losses stripe, fees account, requirements stripe, dashboard full.
  assert.deepEqual(params.controller, {
    stripe_dashboard: { type: "full" },
    requirement_collection: "stripe",
    fees: { payer: "account" },
    losses: { payments: "stripe" },
  });
  // No combination Stripe lists as unsupported for a full dashboard, and `type` is not mixed with `controller`.
  assert.equal("type" in params, false);
  assert.equal(params.country, "CA");
  assert.deepEqual(params.capabilities, { card_payments: { requested: true }, transfers: { requested: true } });
  const src = read("./stripe-connect.ts");
  assert.match(src, /collection_options: \{ fields: "eventually_due" \}/);
  assert.doesNotMatch(src, /requirement_collection: "application"|losses: \{ payments: "application"/);
});
