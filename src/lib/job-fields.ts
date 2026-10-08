// Pure rules for a job's editable fields and a document's place of work. No database access: the
// routes load what these need (the job's current values, whether it has draws / change orders) and
// pass it in, so every rule is unit-tested.

export const MAX_PLACE_LENGTH = 200; // matches the 0060 check constraints
// jobs.contract_value is numeric(12, 2)
export const MAX_CONTRACT_VALUE = 9_999_999_999.99;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type ParsedText =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string };

// A free-text address: undefined = not sent (leave as is), ""/null = clear, otherwise trimmed.
export function parsePlaceText(raw: unknown, label: string): ParsedText {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: `${label} must be text.` };
  const trimmed = raw.trim();
  if (trimmed.length > MAX_PLACE_LENGTH) {
    return { ok: false, error: `${label} must be ${MAX_PLACE_LENGTH} characters or fewer.` };
  }
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

export interface JobPatchUpdate {
  name?: string;
  location?: string | null;
  client_id?: string | null;
  contract_value?: number | null;
  retainage_rate?: number | null;
}

export interface JobCurrent {
  contract_value: number | null;
  retainage_rate: number | null;
}

// What already hangs off the job. Once a progress draw or a change order exists, the contract
// numbers are history: contract_value moves only through change orders from then on.
export interface JobLocks {
  hasDraws: boolean;
  hasChanges: boolean;
}

export type JobPatchResult =
  | { ok: true; update: JobPatchUpdate }
  | { ok: false; error: string; status: 400 | 409 };

export const CONTRACT_LOCKED_MESSAGE =
  "This job already has progress draws or change orders, so its contract value and retainage can't be edited here. Log a change order to adjust the contract.";

function parseNumber(raw: unknown): number | null | "invalid" {
  if (raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  return Number.isFinite(n) ? n : "invalid";
}

// Validates a PATCH /api/jobs/[id] body. Name uniqueness and customer ownership need the database,
// so the route checks those; everything else is decided here.
export function validateJobPatch(
  body: unknown,
  current: JobCurrent,
  locks: JobLocks,
): JobPatchResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const update: JobPatchUpdate = {};

  if (b.name !== undefined) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) return { ok: false, error: "Job name is required.", status: 400 };
    update.name = name;
  }

  const location = parsePlaceText(b.location, "Location");
  if (!location.ok) return { ok: false, error: location.error, status: 400 };
  if (location.value !== undefined) update.location = location.value;

  if (b.client_id !== undefined) {
    if (b.client_id !== null && (typeof b.client_id !== "string" || !b.client_id)) {
      return { ok: false, error: "Customer is invalid.", status: 400 };
    }
    update.client_id = b.client_id as string | null;
  }

  // Contract value: like Start Progress Billing, a real positive amount. Blank clears it (the job
  // stops being progress-billed) and takes the retainage with it.
  let nextContract = current.contract_value;
  if (b.contract_value !== undefined) {
    const parsed = parseNumber(b.contract_value);
    if (parsed === "invalid") {
      return { ok: false, error: "Enter a valid contract value.", status: 400 };
    }
    if (parsed !== null && parsed <= 0) {
      return { ok: false, error: "Contract value must be more than $0.", status: 400 };
    }
    if (parsed !== null && parsed > MAX_CONTRACT_VALUE) {
      return { ok: false, error: "Contract value is too large.", status: 400 };
    }
    const next = parsed === null ? null : round2(parsed);
    if (next !== current.contract_value) {
      if (locks.hasDraws || locks.hasChanges) {
        return { ok: false, error: CONTRACT_LOCKED_MESSAGE, status: 409 };
      }
      update.contract_value = next;
      nextContract = next;
      if (next === null) update.retainage_rate = null;
    }
  }

  // Retainage: blank or 0 means "not using retainage" (null); otherwise strictly between 0 and 100,
  // and only on a job that has a contract value.
  if (b.retainage_rate !== undefined && update.retainage_rate === undefined) {
    const parsed = parseNumber(b.retainage_rate);
    if (parsed === "invalid") {
      return { ok: false, error: "Enter a valid retainage percentage.", status: 400 };
    }
    if (parsed !== null && (parsed < 0 || parsed >= 100)) {
      return { ok: false, error: "Retainage must be less than 100%.", status: 400 };
    }
    const next = parsed === null || parsed === 0 ? null : round2(parsed);
    if (next !== null && nextContract === null) {
      return {
        ok: false,
        error: "Enter a contract value before setting retainage.",
        status: 400,
      };
    }
    if (next !== current.retainage_rate) {
      if (locks.hasDraws || locks.hasChanges) {
        return { ok: false, error: CONTRACT_LOCKED_MESSAGE, status: 409 };
      }
      update.retainage_rate = next;
    }
  }

  return { ok: true, update };
}

// --- Place of work on estimates / invoices -----------------------------------------------------

// Create: use what was typed; if nothing was, copy the linked job's location (a snapshot - a later
// edit to the job doesn't rewrite a sent document).
export function placeOfWorkForNew(
  requested: string | null | undefined,
  jobLocation: string | null | undefined,
): string | null {
  return requested ?? (jobLocation?.trim() || null);
}

// The builder's prefill: the picked job's location, or "" when there is none.
export function defaultPlaceOfWork(
  jobs: { name: string; location?: string | null }[],
  jobName: string | null,
): string {
  if (!jobName) return "";
  return jobs.find((j) => j.name === jobName)?.location?.trim() ?? "";
}

// --- Client prefill from the job's customer -------------------------------------------------------

// Who last set the document's client: the person (picked or typed one) or a job prefill.
export interface ClientPick {
  clientId: string | null; // null = still empty
  source: "user" | "job";
}

// A job with a customer prefills the document's client, but only into an empty field or one a job
// prefill filled earlier - never over a client the person chose. A job with no customer (or one
// that isn't in the owner's client list) changes nothing. Returns `current` itself when nothing
// changes, so callers can compare by reference.
export function clientForJobChange(
  current: ClientPick,
  jobClientId: string | null | undefined,
  knownClientIds: readonly string[],
): ClientPick {
  if (!jobClientId || !knownClientIds.includes(jobClientId)) return current;
  if (current.clientId === null || current.source === "job") {
    return current.clientId === jobClientId && current.source === "job"
      ? current
      : { clientId: jobClientId, source: "job" };
  }
  return current;
}

// The customer of the job picked by name in the builder, or null.
export function jobClientIdByName(
  jobs: { name: string; client_id?: string | null }[],
  jobName: string | null,
): string | null {
  if (!jobName) return null;
  return jobs.find((j) => j.name === jobName)?.client_id ?? null;
}

// --- The job picker in the estimate / invoice builder ---------------------------------------------

export interface PickerJob {
  id: string;
  name: string;
  client_id?: string | null;
  contract_value?: number | null;
}

export interface JobOption {
  value: string; // the job's name - what the builder sends as job_name
  label: string; // "Name · Customer"
  disabled: boolean;
}

// Every job of the owner is listed, with its customer. The one exception is deliberate and visible:
// a progress-billed job (has a contract value) can't take a plain INVOICE - it is invoiced through
// its draws, or its payments would count toward Received without a draw (lib/job-revenue.ts) - so
// it is shown disabled with the reason, never hidden. Estimates can use any job, and the job the
// document already has stays pickable.
export function jobPickerOptions(
  jobs: PickerJob[],
  clients: { id: string; name: string }[],
  opts: { type: "invoice" | "estimate"; isDraw: boolean; selectedName: string | null },
): JobOption[] {
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  return jobs.map((job) => {
    const customer = job.client_id ? clientName.get(job.client_id) : undefined;
    const blocked =
      opts.type === "invoice" &&
      !opts.isDraw &&
      job.contract_value != null &&
      job.name !== opts.selectedName;
    const base = customer ? `${job.name} \u00b7 ${customer}` : job.name;
    return {
      value: job.name,
      label: blocked ? `${base} (progress billing - invoice through draws)` : base,
      disabled: blocked,
    };
  });
}
