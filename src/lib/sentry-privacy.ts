// What Sentry may see. Import-free (no @sentry import) so it can be unit-tested with `node --test`;
// lib/sentry-init.ts is the thin layer that hands these to Sentry.init.
//
// TaxSnap holds client names, emails, addresses, amounts and receipt photos, so the rule is
// "send as little as possible": no request data of any kind, no cookies, no headers, no query
// strings, no user email or name (only the opaque Supabase user id), and every free-text string
// that survives is scrubbed for emails, phone numbers, Stripe keys, tokens and dollar amounts.

type Obj = Record<string, unknown>;

const REMOVED = "[removed]";

// ------------------------------------------------------------------ strings

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const STRIPE_KEY = /\b(?:sk|rk|pk|whsec)_(?:live_|test_)?[A-Za-z0-9*_]{6,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
// 555-123-4567, (555) 123-4567, +1 555 123 4567, +15551234567, 5551234567
const PHONE =
  /(?<![\w.:/-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\w-])|(?<![\w.:/-])\+\d{10,14}(?![\w])|(?<![\w.:/-])\d{10}(?![\w.-])/g;
const AMOUNT = /(?:CA|C)?\$\s?\d[\d,]*(?:\.\d{1,2})?/g;
const LONG_TOKEN = /[A-Za-z0-9_-]{32,}/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function scrubString(text: string): string {
  return text
    .replace(STRIPE_KEY, "[stripe-key]")
    .replace(JWT, "[token]")
    .replace(BEARER, "Bearer [token]")
    .replace(EMAIL, "[email]")
    .replace(PHONE, "[phone]")
    .replace(AMOUNT, "[amount]")
    .replace(LONG_TOKEN, (m) => (UUID.test(m) ? m : "[token]"));
}

// A URL or path without its query string or fragment, with ids and opaque tokens in the path
// swapped for placeholders (/invoice/<token>, /client-login/<token>, storage paths with user ids).
export function scrubUrl(url: string): string {
  let origin = "";
  let rest = url;
  const abs = /^(https?:\/\/[^/?#]+)(.*)$/i.exec(url);
  if (abs) {
    origin = abs[1];
    rest = abs[2];
  }
  const path = rest.split(/[?#]/)[0];
  const cleaned = path
    .split("/")
    .map((seg) => {
      if (UUID.test(seg)) return ":id";
      if (/^[A-Za-z0-9_-]{20,}$/.test(seg)) return ":token";
      if (/^\d{6,}$/.test(seg)) return ":id";
      return seg;
    })
    .join("/");
  return scrubString(origin + cleaned);
}

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || (s.startsWith("/") && !s.includes(" "));
}

// Keys whose value is dropped wherever they appear in extra / contexts / breadcrumb data.
const SENSITIVE_KEY =
  /^(authorization|cookies?|set-cookie|password|passwd|secret|client_secret|token|access_token|refresh_token|api[_-]?key|body|request_body|response_body|requestbody|responsebody|headers|query_string|querystring|email|phone|address|signature|stripe-signature)$/i;

function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return looksLikeUrl(value) ? scrubUrl(value) : scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 6) return REMOVED;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, depth + 1));
  const out: Obj = {};
  for (const [k, v] of Object.entries(value as Obj)) {
    out[k] = SENSITIVE_KEY.test(k) ? REMOVED : scrubValue(v, depth + 1);
  }
  return out;
}

// ------------------------------------------------------------------ which errors are not worth a report

const NEXT_CONTROL_FLOW = /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|NEXT_UNAUTHORIZED|NEXT_FORBIDDEN)/;
const CANCELLED = /\b(AbortError|ResponseAborted|The user aborted a request|The operation was aborted|request aborted|aborted by the user|cancell?ed)\b/i;
const NOISE = /ResizeObserver loop|Non-Error promise rejection captured/i;

// Used by Sentry.init({ ignoreErrors }) as well as the beforeSend check below.
export const IGNORE_ERRORS: RegExp[] = [NEXT_CONTROL_FLOW, CANCELLED, NOISE];

function texts(event: Obj, hint: unknown): string[] {
  const out: string[] = [];
  const original = (hint as { originalException?: unknown } | undefined)?.originalException;
  if (original && typeof original === "object") {
    const o = original as Obj;
    for (const k of ["digest", "message", "name"]) if (typeof o[k] === "string") out.push(o[k] as string);
  } else if (typeof original === "string") {
    out.push(original);
  }
  const values = ((event.exception as Obj | undefined)?.values as Obj[] | undefined) ?? [];
  for (const v of values) {
    if (typeof v.type === "string") out.push(v.type);
    if (typeof v.value === "string") out.push(v.value);
  }
  if (typeof event.message === "string") out.push(event.message);
  return out;
}

function responseStatus(event: Obj): number | null {
  const code = ((event.contexts as Obj | undefined)?.response as Obj | undefined)?.status_code;
  if (typeof code === "number") return code;
  const tag = (event.tags as Obj | undefined)?.["http.status_code"];
  return typeof tag === "number" || typeof tag === "string" ? Number(tag) : null;
}

// Expected 4xx answers, user-cancelled requests, and Next.js not-found / redirect control flow.
// A Stripe webhook failure is always kept: it carries the `stripe_webhook` tag.
export function shouldDropEvent(event: Obj, hint?: unknown): boolean {
  if ((event.tags as Obj | undefined)?.stripe_webhook) return false;
  if (texts(event, hint).some((t) => IGNORE_ERRORS.some((re) => re.test(t)))) return true;
  const status = responseStatus(event);
  return status !== null && status >= 400 && status < 500;
}

// ------------------------------------------------------------------ events

function scrubRequest(request: unknown): Obj | undefined {
  if (!request || typeof request !== "object") return undefined;
  const r = request as Obj;
  const out: Obj = {};
  if (typeof r.method === "string") out.method = r.method;
  if (typeof r.url === "string") out.url = scrubUrl(r.url);
  // headers, cookies, data, query_string, env: never kept
  return out;
}

function routeOf(event: Obj): string | undefined {
  if (typeof event.transaction === "string" && event.transaction) return scrubUrl(event.transaction);
  const url = (event.request as Obj | undefined)?.url;
  if (typeof url === "string") return scrubUrl(url).replace(/^https?:\/\/[^/]+/i, "") || "/";
  return undefined;
}

function scrubException(exception: unknown): unknown {
  if (!exception || typeof exception !== "object") return exception;
  const values = (exception as Obj).values;
  if (!Array.isArray(values)) return exception;
  return {
    ...(exception as Obj),
    values: values.map((v: Obj) => {
      const next: Obj = { ...v };
      if (typeof v.value === "string") next.value = scrubString(v.value);
      const st = v.stacktrace as Obj | undefined;
      if (st && Array.isArray(st.frames)) {
        next.stacktrace = {
          ...st,
          frames: (st.frames as Obj[]).map((f) => {
            const { vars: _vars, pre_context: _pre, post_context: _post, context_line: _line, ...keep } = f;
            void _vars; void _pre; void _post; void _line;
            if (typeof keep.filename === "string") keep.filename = scrubUrl(keep.filename);
            if (typeof keep.abs_path === "string") keep.abs_path = scrubUrl(keep.abs_path);
            return keep;
          }),
        };
      }
      return next;
    }),
  };
}

// contexts are scrubbed like any other free-form data EXCEPT the trace context: its trace_id is 32
// hex characters, which the long-token rule would turn into "[token]" - an invalid id that Sentry's
// ingest can refuse, so the whole event is lost. Its ids are kept; only its data is cut down.
function scrubContexts(contexts: unknown): unknown {
  if (!contexts || typeof contexts !== "object") return contexts;
  const { trace, ...rest } = contexts as Obj;
  const out = scrubValue(rest) as Obj;
  if (trace && typeof trace === "object") {
    const t = trace as Obj;
    out.trace = { ...t, data: scrubSpanData(t.data), description: undefined };
  }
  return out;
}

// beforeSend for error events. Returns null to drop the event.
export function scrubEvent<T extends object>(input: T, hint?: unknown): T | null {
  const event = input as unknown as Obj;
  if (shouldDropEvent(event, hint)) return null;

  const route = routeOf(event);

  event.request = scrubRequest(event.request);

  // Only the opaque id. Never email, username, ip_address or anything else on the user.
  const userId = (event.user as Obj | undefined)?.id;
  event.user = userId !== undefined && userId !== null ? { id: String(userId) } : undefined;

  if (typeof event.message === "string") event.message = scrubString(event.message);
  const logentry = event.logentry as Obj | undefined;
  if (logentry && typeof logentry.message === "string") logentry.message = scrubString(logentry.message);
  if (event.exception) event.exception = scrubException(event.exception);
  if (typeof event.transaction === "string") event.transaction = scrubUrl(event.transaction);

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = (event.breadcrumbs as Obj[])
      .map((b) => scrubBreadcrumb(b))
      .filter((b): b is Obj => b !== null);
  }
  if (event.extra) event.extra = scrubValue(event.extra);
  if (event.contexts) event.contexts = scrubContexts(event.contexts);

  delete event.server_name;
  delete event.modules;
  delete event.sdkProcessingMetadata;

  const tags = { ...((event.tags as Obj | undefined) ?? {}) };
  if (route && tags.route === undefined) tags.route = route;
  event.tags = tags;

  return input;
}

const SPAN_DATA_KEEP = new Set([
  "http.method",
  "http.request.method",
  "http.response.status_code",
  "http.status_code",
  "sentry.op",
  "sentry.origin",
]);

function scrubSpanData(data: unknown): Obj | undefined {
  if (!data || typeof data !== "object") return undefined;
  const out: Obj = {};
  for (const [k, v] of Object.entries(data as Obj)) if (SPAN_DATA_KEEP.has(k)) out[k] = v;
  return out;
}

// beforeSendTransaction: keep timing and shape, drop everything that could carry data.
export function scrubTransaction<T extends object>(input: T): T | null {
  const event = input as unknown as Obj;
  event.request = scrubRequest(event.request);
  const userId = (event.user as Obj | undefined)?.id;
  event.user = userId !== undefined && userId !== null ? { id: String(userId) } : undefined;
  if (typeof event.transaction === "string") event.transaction = scrubUrl(event.transaction);
  if (Array.isArray(event.spans)) {
    event.spans = (event.spans as Obj[]).map((s) => ({
      ...s,
      description: typeof s.description === "string" ? scrubUrl(s.description) : s.description,
      data: scrubSpanData(s.data),
    }));
  }
  const trace = (event.contexts as Obj | undefined)?.trace as Obj | undefined;
  if (trace) {
    event.contexts = {
      ...(event.contexts as Obj),
      trace: { ...trace, data: scrubSpanData(trace.data), description: undefined },
    };
  }
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = (event.breadcrumbs as Obj[]).map((b) => scrubBreadcrumb(b)).filter((b): b is Obj => b !== null);
  }
  if (event.extra) event.extra = scrubValue(event.extra);
  delete event.server_name;
  delete event.modules;
  delete event.sdkProcessingMetadata;
  return input;
}

// beforeBreadcrumb. Console output and typed input are dropped outright; fetch/XHR keep only
// method, status and a path with no query; everything else has its strings scrubbed.
export function scrubBreadcrumb<T extends object>(input: T): T | null {
  const b = input as unknown as Obj;
  const category = typeof b.category === "string" ? b.category : "";
  if (category === "console" || category === "ui.input") return null;

  if (category === "fetch" || category === "xhr" || category === "http") {
    const data = (b.data ?? {}) as Obj;
    const next: Obj = {
      type: b.type,
      category,
      level: b.level,
      timestamp: b.timestamp,
      data: {
        method: data.method,
        status_code: data.status_code,
        url: typeof data.url === "string" ? scrubUrl(data.url) : undefined,
      },
    };
    return next as unknown as T;
  }

  if (typeof b.message === "string") b.message = scrubString(b.message);
  if (b.data) b.data = scrubValue(b.data);
  return input;
}

// ------------------------------------------------------------------ configuration

export const TRACES_SAMPLE_RATE = 0.05;

export interface SentryEnv {
  dsn?: string;
  // "production" | "preview" | "development" (Vercel's VERCEL_ENV). Anything else, including
  // unset (a local `npm run dev` or `npm run build && npm run start`), counts as development.
  vercelEnv?: string;
  release?: string;
}

export interface SentryRuntimeConfig {
  dsn: string;
  environment: "production";
  release?: string;
}

// null = Sentry stays completely off: no DSN, or not the production deployment.
export function resolveSentryConfig(env: SentryEnv): SentryRuntimeConfig | null {
  const dsn = env.dsn?.trim();
  if (!dsn) return null;
  if (env.vercelEnv !== "production") return null;
  return { dsn, environment: "production", release: env.release?.trim() || undefined };
}

// The options handed to Sentry.init, or null when Sentry must do nothing.
export function buildSentryOptions(env: SentryEnv): Obj | null {
  const config = resolveSentryConfig(env);
  if (!config) return null;
  return {
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    sendDefaultPii: false,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    // v11 streams spans by default and then IGNORES beforeSendTransaction, which would send span
    // data unscrubbed. 'static' sends whole transactions, so scrubTransaction really runs.
    traceLifecycle: "static",
    // no profiling, no session replay: neither profilesSampleRate nor replayIntegration is set
    ignoreErrors: IGNORE_ERRORS,
    maxBreadcrumbs: 30,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubTransaction,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

// Calls `init` only when there is something to start. Returns whether Sentry was started.
export function startSentry(env: SentryEnv, init: (options: Obj) => unknown): boolean {
  const options = buildSentryOptions(env);
  if (!options) return false;
  init(options);
  return true;
}

// ------------------------------------------------------------------ errors we capture by hand

// A copy that keeps the type and stack but carries only a scrubbed message - never the original
// object, which can hold request bodies (a Stripe error carries its raw request) or DB rows.
export function toSafeError(err: unknown, context: string): Error {
  let message: string;
  let name = "Error";
  let stack: string | undefined;
  if (err instanceof Error) {
    message = err.message;
    name = err.name;
    stack = err.stack;
  } else if (err && typeof err === "object") {
    const o = err as Obj;
    const code = typeof o.code === "string" ? `${o.code} ` : "";
    message = `${code}${typeof o.message === "string" ? o.message : "unknown error"}`;
  } else {
    message = String(err);
  }
  const safe = new Error(scrubString(`${context}: ${message}`));
  safe.name = name;
  if (stack) safe.stack = scrubString(stack);
  return safe;
}
