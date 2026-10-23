import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRACES_SAMPLE_RATE,
  buildSentryOptions,
  resolveSentryConfig,
  scrubBreadcrumb,
  scrubEvent,
  scrubString,
  scrubTransaction,
  scrubUrl,
  shouldDropEvent,
  startSentry,
  toSafeError,
} from "./sentry-privacy.ts";

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const DSN = "https://key@o1.ingest.sentry.io/1";

// ------------------------------------------------------------------ strings (all data below is fake)

test("scrubString removes emails, phones, Stripe keys, tokens and amounts", () => {
  const s = scrubString(
    "Failed for jane.doe+test@example.com, call (416) 555-0199 or +1 416 555 0123 or 4165550142 " +
      "key sk_live_FAKEFAKEFAKE1234 and whsec_FAKEFAKE1234 rk_test_abcdef123456 " +
      "Bearer abc.def.ghi-123 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.c2lnbmF0dXJl " +
      "token tok_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA total $1,234.56 and CA$99",
  );
  for (const leaked of ["jane.doe", "example.com", "555-0199", "555 0123", "4165550142", "FAKEFAKE", "abcdef123456", "abc.def.ghi", "eyJhbGci", "AAAAAAAA", "1,234", "CA$99"]) {
    assert.ok(!s.includes(leaked), `"${leaked}" still in: ${s}`);
  }
  for (const marker of ["[email]", "[phone]", "[stripe-key]", "Bearer [token]", "[amount]"]) assert.ok(s.includes(marker), marker);
});

test("scrubString leaves ordinary text, uuids and short ids alone", () => {
  const text = "Processing failed for event evt_1NG8Du2eZvKYlo2CUI79 at line 42:7";
  assert.equal(scrubString(text), text);
  const uuid = "3f2b8c1e-9d4a-4b6f-8a21-0c5d7e9f1a23";
  assert.equal(scrubString(`user ${uuid}`), `user ${uuid}`);
});

test("scrubUrl drops the query and fragment and replaces ids and opaque tokens", () => {
  assert.equal(scrubUrl("https://gettaxsnap.ca/api/clients?email=a@b.co&x=1#top"), "https://gettaxsnap.ca/api/clients");
  assert.equal(scrubUrl("/invoice/Zk3nQ8vL2mXp9RtY4wBc7HdA"), "/invoice/:token");
  assert.equal(scrubUrl("/client-login/Zk3nQ8vL2mXp9RtY4wBc7HdA?next=/x"), "/client-login/:token");
  assert.equal(scrubUrl("/dashboard/clients/3f2b8c1e-9d4a-4b6f-8a21-0c5d7e9f1a23"), "/dashboard/clients/:id");
  assert.equal(scrubUrl("/api/stripe/connect-webhook"), "/api/stripe/connect-webhook");
});

// ------------------------------------------------------------------ events

function sampleEvent(): Obj {
  return {
    event_id: "abc",
    message: "Could not email jane@example.com",
    server_name: "ip-10-0-0-1",
    transaction: "POST /invoice/Zk3nQ8vL2mXp9RtY4wBc7HdA",
    request: {
      method: "POST",
      url: "https://gettaxsnap.ca/api/clients/import?email=jane@example.com",
      headers: { cookie: "sb-access-token=secret", authorization: "Bearer secretsecretsecretsecretsecretsecret" },
      cookies: { a: "b" },
      data: { name: "Jane Client", email: "jane@example.com", address: "1 Fake St" },
      query_string: "email=jane@example.com",
    },
    user: { id: "3f2b8c1e-9d4a-4b6f-8a21-0c5d7e9f1a23", email: "owner@example.com", username: "owner", ip_address: "203.0.113.9" },
    exception: {
      values: [
        {
          type: "Error",
          value: "duplicate key (email)=(jane@example.com) 416-555-0142",
          stacktrace: {
            frames: [
              {
                filename: "/var/task/x.js?v=1",
                vars: { secret: "x" },
                context_line: "const email = 'jane@example.com'",
                pre_context: ["a"],
                post_context: ["b"],
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: [
      { category: "console", message: "client Jane Client paid $50" },
      { category: "ui.input", message: "typing" },
      {
        category: "fetch",
        data: {
          url: "https://x.supabase.co/rest/v1/clients?email=eq.jane@example.com",
          method: "GET",
          status_code: 200,
          request_body: '{"name":"Jane"}',
          response_body: "[{...}]",
        },
      },
      { category: "navigation", message: "to jane@example.com", data: { to: "/invoice/Zk3nQ8vL2mXp9RtY4wBc7HdA?x=1", body: "secret" } },
    ],
    extra: { note: "email jane@example.com", headers: { a: "b" }, nested: { password: "hunter2", amount: "$40.00" } },
    contexts: { os: { name: "Windows" }, runtime: { name: "node" } },
    tags: { stripe_event_id: "evt_1NG8Du2eZvKYlo2CUI79" },
  };
}

test("scrubEvent strips request data, user details, breadcrumb bodies and PII strings", () => {
  const e = scrubEvent(sampleEvent())!;
  assert.deepEqual(e.request, { method: "POST", url: "https://gettaxsnap.ca/api/clients/import" });
  assert.deepEqual(e.user, { id: "3f2b8c1e-9d4a-4b6f-8a21-0c5d7e9f1a23" });
  assert.equal(e.server_name, undefined);
  assert.equal(e.message, "Could not email [email]");
  const frame = e.exception.values[0].stacktrace.frames[0];
  assert.deepEqual(Object.keys(frame), ["filename"]);
  assert.equal(frame.filename, "/var/task/x.js");
  assert.equal(e.exception.values[0].value, "duplicate key (email)=([email]) [phone]");
  // console + typed input gone; fetch reduced to method/status/path; other crumbs scrubbed
  assert.equal(e.breadcrumbs.length, 2);
  assert.deepEqual(e.breadcrumbs[0].data, { method: "GET", status_code: 200, url: "https://x.supabase.co/rest/v1/clients" });
  assert.equal(e.breadcrumbs[1].message, "to [email]");
  assert.equal(e.breadcrumbs[1].data.body, "[removed]");
  assert.equal(e.breadcrumbs[1].data.to, "/invoice/:token");
  assert.equal(e.extra.headers, "[removed]");
  assert.equal(e.extra.nested.password, "[removed]");
  assert.equal(e.extra.nested.amount, "[amount]");
  assert.equal(e.extra.note, "email [email]");
  assert.deepEqual(e.contexts, { os: { name: "Windows" }, runtime: { name: "node" } });
  assert.equal(e.transaction, "POST /invoice/:token");
  assert.equal(e.tags.route, "POST /invoice/:token");
  assert.equal(e.tags.stripe_event_id, "evt_1NG8Du2eZvKYlo2CUI79");
  const dump = JSON.stringify(e);
  for (const leaked of ["jane@example.com", "owner@example.com", "203.0.113.9", "hunter2", "Jane Client", "sb-access-token", "1 Fake St"]) {
    assert.ok(!dump.includes(leaked), `${leaked} leaked`);
  }
});

test("the trace context keeps its ids (a mangled trace_id loses the whole event) but loses its data", () => {
  const traceId = "4e295bb56e5f44bd96247a765f10066b";
  const e = scrubEvent({
    message: "x",
    contexts: {
      trace: { trace_id: traceId, span_id: "b67ca39ff0e55909", op: "http.server", data: { "url.full": "https://x/?a=b@c.co", "sentry.op": "http.server" } },
      runtime: { name: "node", version: "v25.7.0" },
    },
  }) as Obj;
  assert.equal(e.contexts.trace.trace_id, traceId);
  assert.equal(e.contexts.trace.span_id, "b67ca39ff0e55909");
  assert.deepEqual(e.contexts.trace.data, { "sentry.op": "http.server" });
  assert.deepEqual(e.contexts.runtime, { name: "node", version: "v25.7.0" });
  // an ordinary long token elsewhere in contexts is still scrubbed
  const o = scrubEvent({ contexts: { custom: { id: "Zk3nQ8vL2mXp9RtY4wBc7HdA1234567890" } } }) as Obj;
  assert.equal(o.contexts.custom.id, "[token]");
});

test("scrubEvent attaches no user when there is no id", () => {
  const e = scrubEvent({ user: { email: "a@b.co", username: "x" } })!;
  assert.equal((e as Obj).user, undefined);
});

test("scrubTransaction removes request data and span data, keeps timing shape", () => {
  const t = scrubTransaction({
    transaction: "GET /invoice/Zk3nQ8vL2mXp9RtY4wBc7HdA",
    request: { url: "https://gettaxsnap.ca/invoice/Zk3nQ8vL2mXp9RtY4wBc7HdA?x=1", headers: { cookie: "c" }, data: "d" },
    user: { id: "u1", email: "a@b.co" },
    spans: [
      {
        op: "http.client",
        description: "GET https://x.supabase.co/rest/v1/clients?email=eq.a@b.co",
        data: { "http.query": "?email=a@b.co", "http.response.status_code": 200 },
      },
    ],
    contexts: { trace: { trace_id: "t", data: { "url.full": "https://x/?a=b@c.co", "sentry.op": "http.server" } } },
  } as Obj) as Obj;
  assert.deepEqual(t.request, { url: "https://gettaxsnap.ca/invoice/:token" });
  assert.deepEqual(t.user, { id: "u1" });
  assert.equal(t.spans[0].description, "GET https://x.supabase.co/rest/v1/clients");
  assert.deepEqual(t.spans[0].data, { "http.response.status_code": 200 });
  assert.deepEqual(t.contexts.trace.data, { "sentry.op": "http.server" });
  assert.ok(!JSON.stringify(t).includes("b@c.co") && !JSON.stringify(t).includes("a@b.co"));
});

test("scrubBreadcrumb", () => {
  assert.equal(scrubBreadcrumb({ category: "console", message: "x" }), null);
  assert.equal(scrubBreadcrumb({ category: "ui.input", message: "x" }), null);
  const xhr = scrubBreadcrumb({ category: "xhr", data: { url: "/api/a?x=1", method: "POST", request_body: "b", status_code: 500 } }) as Obj;
  assert.deepEqual(xhr.data, { method: "POST", status_code: 500, url: "/api/a" });
});

// ------------------------------------------------------------------ what is not reported

test("expected 4xx, cancelled requests and Next.js control flow are dropped", () => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/x;307;" });
  const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  const abort = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
  assert.equal(scrubEvent({}, { originalException: redirect }), null);
  assert.equal(scrubEvent({}, { originalException: notFound }), null);
  assert.equal(scrubEvent({}, { originalException: abort }), null);
  assert.equal(scrubEvent({ exception: { values: [{ type: "Error", value: "NEXT_NOT_FOUND" }] } }), null);
  assert.equal(scrubEvent({ contexts: { response: { status_code: 404 } } }), null);
  assert.equal(scrubEvent({ contexts: { response: { status_code: 422 } } }), null);
  assert.notEqual(scrubEvent({ contexts: { response: { status_code: 500 } } }), null);
  assert.notEqual(scrubEvent({ exception: { values: [{ type: "TypeError", value: "x is undefined" }] } }), null);
});

test("a Stripe webhook failure is never dropped, even with a 4xx status", () => {
  assert.equal(shouldDropEvent({ tags: { stripe_webhook: "failed" }, contexts: { response: { status_code: 400 } } }), false);
});

test("the exact failed-signature event survives the scrubber intact", () => {
  const out = scrubEvent(
    {
      exception: { values: [{ type: "Error", value: "/api/stripe/connect-webhook: Stripe webhook signature check failed" }] },
      level: "error",
      tags: { route: "/api/stripe/connect-webhook", stripe_webhook: "failed", webhook_stage: "signature", stripe_event_type: "unverified", stripe_event_id: "unverified" },
      contexts: { trace: { trace_id: "4e295bb56e5f44bd96247a765f10066b", span_id: "b67ca39ff0e55909" } },
      request: { method: "POST", url: "http://127.0.0.1:3111/api/stripe/connect-webhook" },
    },
    { originalException: new Error("/api/stripe/connect-webhook: Stripe webhook signature check failed") },
  ) as Obj;
  assert.ok(out, "not dropped");
  assert.equal(out.exception.values[0].value, "/api/stripe/connect-webhook: Stripe webhook signature check failed");
  assert.equal(out.tags.stripe_webhook, "failed");
  assert.equal(out.contexts.trace.trace_id, "4e295bb56e5f44bd96247a765f10066b");
});

// ------------------------------------------------------------------ configuration

test("no DSN means Sentry does nothing at all", () => {
  assert.equal(resolveSentryConfig({ vercelEnv: "production" }), null);
  assert.equal(resolveSentryConfig({ dsn: "", vercelEnv: "production" }), null);
  assert.equal(resolveSentryConfig({ dsn: "   ", vercelEnv: "production" }), null);
  assert.equal(buildSentryOptions({ vercelEnv: "production" }), null);
  let inits = 0;
  assert.equal(startSentry({ vercelEnv: "production" }, () => inits++), false);
  assert.equal(startSentry({ dsn: undefined }, () => inits++), false);
  assert.equal(inits, 0, "Sentry.init is never called without a DSN");
});

test("nothing is sent from local development or preview deployments", () => {
  for (const vercelEnv of [undefined, "", "development", "preview", "staging"]) {
    assert.equal(resolveSentryConfig({ dsn: DSN, vercelEnv }), null, String(vercelEnv));
  }
  assert.deepEqual(resolveSentryConfig({ dsn: DSN, vercelEnv: "production", release: " abc123 " }), {
    dsn: DSN,
    environment: "production",
    release: "abc123",
  });
});

test("production options: no PII, no replay, no profiling, 5% tracing, scrubbers wired", () => {
  const options = buildSentryOptions({ dsn: DSN, vercelEnv: "production", release: "sha1" })!;
  assert.equal(options.sendDefaultPii, false);
  assert.equal(options.tracesSampleRate, TRACES_SAMPLE_RATE);
  assert.equal(options.traceLifecycle, "static", "otherwise beforeSendTransaction is ignored and spans go out unscrubbed");
  assert.equal(TRACES_SAMPLE_RATE, 0.05);
  assert.equal(options.environment, "production");
  assert.equal(options.release, "sha1");
  assert.equal(options.beforeSend, scrubEvent);
  assert.equal(options.beforeSendTransaction, scrubTransaction);
  assert.equal(options.beforeBreadcrumb, scrubBreadcrumb);
  for (const off of ["profilesSampleRate", "profileSessionSampleRate", "replaysSessionSampleRate", "replaysOnErrorSampleRate", "integrations"]) {
    assert.equal(options[off], undefined, `${off} must stay unset`);
  }
  let seen: unknown = null;
  assert.equal(startSentry({ dsn: DSN, vercelEnv: "production" }, (o) => (seen = o)), true);
  assert.ok(seen);
});

test("toSafeError keeps type and stack but not the original object or secrets", () => {
  const stripeLike = Object.assign(new Error("Invalid API Key provided: sk_live_FAKEFAKE1234 for jane@example.com"), {
    name: "StripeAuthenticationError",
    raw: { requestBody: "card=4242" },
  });
  const safe = toSafeError(stripeLike, "/api/x");
  assert.equal(safe.name, "StripeAuthenticationError");
  assert.ok(!safe.message.includes("sk_live") && !safe.message.includes("jane"));
  assert.ok(!("raw" in safe));
  assert.match(toSafeError({ code: "23505", message: "dup (email)=(a@b.co)" }, "/api/y").message, /^\/api\/y: 23505 dup \(email\)=\(\[email\]\)$/);
});

// ------------------------------------------------------------------ static checks

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test("no Sentry call is handed a request, a request body, headers or cookies", () => {
  const srcDir = fileURLToPath(new URL("..", import.meta.url));
  const files = sourceFiles(srcDir).filter((f) => /Sentry\.|captureRouteError\(|captureStripeWebhookFailure\(/.test(readFileSync(f, "utf8")));
  assert.ok(files.length >= 8, "the capture sites exist");
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    const calls = [...text.matchAll(/(?:Sentry\.capture\w+|captureRouteError|captureStripeWebhookFailure|setExtra|setContext|setUser)\s*\(([^)]*)\)/g)];
    for (const [, args] of calls) {
      assert.doesNotMatch(args, /\b(request|req|body|headers|cookies?|payload|formData|searchParams|rawBody)\b/, `${f}: ${args}`);
    }
    if (!f.endsWith("sentry-privacy.ts")) {
      assert.doesNotMatch(text, /sendDefaultPii:\s*true|replayIntegration|replaysSessionSampleRate|profilesSampleRate/, f);
    }
    assert.doesNotMatch(text, /setUser\(\s*\{[^}]*(email|username|ip_address)/, f);
  }
});

test("both webhooks and the swallowing routes report failures with tags, never the payload", () => {
  const connect = read("../app/api/stripe/connect-webhook/route.ts");
  const sub = read("../app/api/stripe/webhook/route.ts");
  for (const src of [connect, sub]) {
    assert.match(src, /captureStripeWebhookFailure\(\{ route: ROUTE, stage: "signature"/);
    assert.match(src, /captureStripeWebhookFailure\(\{ route: ROUTE, stage: "processing", err, eventType: event\.type, eventId: event\.id \}\)/);
    assert.match(src, /stage: "config"/);
  }
  const capture = read("./sentry-capture.ts");
  assert.match(capture, /"unverified"/, "event type/id are never read from an unverified body");
  assert.match(capture, /setTag\("stripe_event_type"/);
  assert.match(capture, /setTag\("stripe_event_id"/);
  for (const f of [
    "../app/api/public/invoice/[token]/checkout/route.ts",
    "../app/api/stripe/connect/start/route.ts",
    "../app/api/stripe/connect/refresh/route.ts",
    "../app/api/stripe/connect/return/route.ts",
    "../app/api/stripe/portal/route.ts",
    "../app/api/parse-receipt/route.ts",
    "../app/api/clients/import/route.ts",
  ]) {
    assert.match(read(f), /captureRouteError\(/, f);
  }
});

test("DSN missing: instrumentation and the browser entry return before loading Sentry", () => {
  const inst = read("../instrumentation.ts");
  assert.match(inst, /if \(process\.env\.SENTRY_DSN\) \{\s*const \{ initSentry \} = await import/);
  assert.match(inst, /if \(!process\.env\.SENTRY_DSN\) return;\s*const Sentry = await import/);
  assert.doesNotMatch(inst, /^import .*sentry/im, "no static Sentry import");
  const client = read("../instrumentation-client.ts");
  assert.match(client, /if \(resolveSentryConfig\(env\)\)/);
  assert.doesNotMatch(client, /^import .*@sentry/m);
  const cfg = read("../../next.config.ts");
  assert.match(cfg, /SENTRY_AUTH_TOKEN && process\.env\.SENTRY_ORG && process\.env\.SENTRY_PROJECT/);
  assert.match(cfg, /: nextConfig;/, "source map upload is skipped cleanly");
});
