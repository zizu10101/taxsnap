import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Receipt } from "@/lib/database.types";
import type { ReadDb } from "@/lib/scoped-reader";
import type { PdfDocument } from "@/lib/invoice-pdf";

// Read-only loaders for the accountant portal. Every one takes a ReadDb built
// by createScopedReader (scoped to the session's business, select-only) -
// never a raw service client - so the table allowlist and user_id filter
// apply to everything here. Storage signing (receipt photos, the logo) is the
// one other door, and it re-verifies each path against the scoped reader.

export interface AccountantBusiness {
  name: string | null;
  email: string;
  phone: string | null;
  address: string | null;
}

export async function loadAccountantBusiness(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ business: AccountantBusiness; logoPath: string | null }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name, business_email, business_phone, business_address, logo_url")
    .eq("id", userId)
    .single();
  return {
    business: {
      name: profile?.business_name ?? null,
      email: profile?.business_email ?? "",
      phone: profile?.business_phone ?? null,
      address: profile?.business_address ?? null,
    },
    logoPath: profile?.logo_url ?? null,
  };
}

export async function listAccountantExpenses(db: ReadDb): Promise<Receipt[]> {
  const { data } = await db
    .from("receipts")
    .select("*")
    .order("transaction_date", { ascending: false });
  return (data ?? []) as Receipt[];
}

export async function listAccountantBankAccounts(
  db: ReadDb,
): Promise<{ id: string; name: string }[]> {
  const { data } = await db.from("bank_accounts").select("id, name");
  return data ?? [];
}

export interface AccountantDocumentRow {
  id: string;
  type: "invoice" | "estimate";
  status: "draft" | "sent" | "partial" | "paid";
  document_number: number;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  hst_amount: number;
  total_amount: number;
  excluded_from_hst: boolean;
  client_name: string | null;
  job_name: string | null;
  // Payments received against an invoice (0 for an estimate).
  paid: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Every invoice and estimate, drafts included (the status column says which).
export async function listAccountantDocuments(db: ReadDb): Promise<AccountantDocumentRow[]> {
  const { data } = await db
    .from("documents")
    .select(
      "id, type, status, document_number, issue_date, due_date, subtotal, hst_amount, total_amount, excluded_from_hst, client:clients(name), job:jobs(name), payments(amount)",
    )
    .order("issue_date", { ascending: false })
    .order("document_number", { ascending: false });

  type Raw = Omit<AccountantDocumentRow, "client_name" | "job_name" | "paid"> & {
    client: { name: string } | null;
    job: { name: string } | null;
    payments: { amount: number }[] | null;
  };
  return ((data ?? []) as unknown as Raw[]).map(({ client, job, payments, ...rest }) => ({
    ...rest,
    client_name: client?.name ?? null,
    job_name: job?.name ?? null,
    paid: rest.type === "invoice" ? round2((payments ?? []).reduce((s, p) => s + p.amount, 0)) : 0,
  }));
}

export interface AccountantPayment {
  id: string;
  amount: number;
  paid_date: string;
  method: string | null;
  note: string | null;
  deposited_to: string | null;
}

export interface AccountantDocumentDetail {
  document: PdfDocument & {
    id: string;
    items: { id: string; description: string; quantity: number; unit_price: number }[];
    excluded_from_hst: boolean;
  };
  payments: AccountantPayment[];
  paid: number;
}

export async function getAccountantDocument(
  db: ReadDb,
  id: string,
): Promise<AccountantDocumentDetail | null> {
  const [{ data }, accounts] = await Promise.all([
    db
      .from("documents")
      .select(
        "id, type, status, document_number, issue_date, due_date, subtotal, hst_amount, total_amount, excluded_from_hst, is_progress_draw, draw_number, place_of_work, job:jobs(name), client:clients(name, email, address), items:document_items(id, name, description, unit, quantity, unit_price, sort_order), payments(id, amount, paid_date, method, note, bank_account_id)",
      )
      .eq("id", id)
      .maybeSingle(),
    listAccountantBankAccounts(db),
  ]);
  if (!data) return null;

  type Raw = {
    id: string;
    type: "invoice" | "estimate";
    status: "draft" | "sent" | "partial" | "paid";
    document_number: number;
    issue_date: string;
    due_date: string | null;
    subtotal: number;
    hst_amount: number;
    total_amount: number;
    excluded_from_hst: boolean;
    is_progress_draw: boolean;
    draw_number: number | null;
    place_of_work: string | null;
    job: { name: string } | null;
    client: { name: string; email: string | null; address: string | null } | null;
    items: {
      id: string;
      name: string | null;
      description: string;
      unit: string | null;
      quantity: number;
      unit_price: number;
      sort_order: number;
    }[];
    payments: {
      id: string;
      amount: number;
      paid_date: string;
      method: string | null;
      note: string | null;
      bank_account_id: string | null;
    }[];
  };
  const raw = data as unknown as Raw;
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const payments = [...raw.payments]
    .sort((a, b) => (a.paid_date < b.paid_date ? -1 : 1))
    .map((p) => ({
      id: p.id,
      amount: p.amount,
      paid_date: p.paid_date,
      method: p.method,
      note: p.note,
      deposited_to: p.bank_account_id ? (accountNames.get(p.bank_account_id) ?? null) : null,
    }));

  return {
    document: {
      id: raw.id,
      type: raw.type,
      status: raw.status,
      document_number: raw.document_number,
      issue_date: raw.issue_date,
      due_date: raw.due_date,
      subtotal: raw.subtotal,
      hst_amount: raw.hst_amount,
      total_amount: raw.total_amount,
      excluded_from_hst: raw.excluded_from_hst,
      is_progress_draw: raw.is_progress_draw,
      draw_number: raw.draw_number,
      draw_percent_complete: null,
      draw_description: null,
      place_of_work: raw.place_of_work,
      // The name only - never the job's contract value or costs.
      job: raw.job ? { name: raw.job.name } : null,
      client: raw.client,
      items: [...raw.items]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(({ id: itemId, name, description, unit, quantity, unit_price }) => ({
          id: itemId,
          name,
          description,
          unit,
          quantity,
          unit_price,
        })),
    },
    payments,
    paid: raw.type === "invoice" ? round2(payments.reduce((s, p) => s + p.amount, 0)) : 0,
  };
}

export interface AccountantHourRow {
  id: string;
  work_date: string;
  employee_name: string;
  job_name: string;
  hours: number;
  rate: number;
  labor_cost: number;
}

// Hours and what they cost. Employee names and rates only - PINs live in
// employee_pins, which the reader cannot open at all.
export async function listAccountantHours(db: ReadDb): Promise<AccountantHourRow[]> {
  const { data } = await db
    .from("hour_entries")
    .select("id, work_date, hours, rate, labor_cost, employee:employees(name), job:jobs(name)")
    .order("work_date", { ascending: false });

  type Raw = {
    id: string;
    work_date: string;
    hours: number;
    rate: number;
    labor_cost: number;
    employee: { name: string } | null;
    job: { name: string } | null;
  };
  return ((data ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id,
    work_date: r.work_date,
    employee_name: r.employee?.name ?? "—",
    job_name: r.job?.name ?? "—",
    hours: r.hours,
    rate: r.rate,
    labor_cost: r.labor_cost,
  }));
}

// Signed URL for one receipt photo, only if the receipt is this business's.
export async function signReceiptImage(
  supabase: SupabaseClient<Database>,
  db: ReadDb,
  receiptId: string,
): Promise<string | null> {
  const { data } = await db.from("receipts").select("image_url").eq("id", receiptId).maybeSingle();
  const path = (data as { image_url: string | null } | null)?.image_url;
  if (!path) return null;
  const { data: signed } = await supabase.storage.from("receipts").createSignedUrl(path, 60 * 10);
  return signed?.signedUrl ?? null;
}
