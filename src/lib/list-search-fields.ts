// What each list's search box looks at. One small pure function per list, so which fields a list
// searches is written down once and tested - the components only call searchList() with these.

import { amountSearchText, type SearchField } from "./list-search.ts";
import { formatContractNumber } from "./contract-number.ts";
import { formatDocumentNumber } from "./document-number.ts";

export function clientSearchFields(c: {
  name: string;
  email?: string | null;
  address?: string | null;
  phone?: string | null; // not a column today; searched if one is added
}): SearchField[] {
  return [c.name, c.email, c.phone, c.address];
}

export function documentSearchFields(
  d: {
    type: "invoice" | "estimate";
    document_number: number;
    status: string;
    place_of_work?: string | null;
    client?: { name: string } | null;
    job?: { name: string } | null;
  },
  extra: { converted?: boolean } = {},
): SearchField[] {
  return [
    formatDocumentNumber(d.type, d.document_number), // "INV-1004"
    d.document_number, // "1004"
    d.client?.name,
    d.job?.name,
    d.place_of_work,
    d.status,
    extra.converted ? "converted" : null,
  ];
}

export function jobSearchFields(
  j: { name: string; location?: string | null; contract_number?: number | null },
  customerName?: string | null,
): SearchField[] {
  return [
    j.name,
    j.location,
    customerName,
    j.contract_number != null ? formatContractNumber(j.contract_number) : null, // "CON-00100"
    j.contract_number,
  ];
}

// Receipts have no free-text note column; the scanned line items' names are the closest
// "what was this" text, so they are searched with the vendor, category, job and amount.
export function expenseSearchFields(r: {
  merchant_name: string;
  tax_category: string;
  job_name?: string | null;
  total_amount: number;
  items?: { name?: string | null }[] | null;
}): SearchField[] {
  return [
    r.merchant_name,
    r.tax_category,
    r.job_name,
    ...(r.items ?? []).map((i) => i.name),
    amountSearchText(r.total_amount),
  ];
}

export function nameSearchFields(x: { name: string }, ...more: SearchField[]): SearchField[] {
  return [x.name, ...more];
}

export function hourSearchFields(h: {
  employee?: { name: string } | null;
  job?: { name: string } | null;
}): SearchField[] {
  return [h.employee?.name, h.job?.name];
}

export function savedItemSearchFields(i: { description: string }): SearchField[] {
  return [i.description];
}
