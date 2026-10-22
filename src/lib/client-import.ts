// Import clients from a CSV file or cells pasted from Excel / Google Sheets.
// Everything here is pure (no I/O, no logging): the dialog uses it to parse and map in the
// browser, and POST /api/clients/import uses planImport() to enforce the rules on the server.

export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_BYTES = 1024 * 1024;
// The normal client form has no length limits of its own; these keep an import from filling
// the table with junk and are far above any real name, email (RFC 5321: 254) or address.
export const IMPORT_FIELD_LIMITS = { name: 120, email: 254, address: 300 } as const;

import { normalizePhone } from "./client-phone.ts";

// ------------------------------------------------------------------ parsing

export type Delimiter = "," | ";" | "\t";

export interface ParsedTable {
  delimiter: Delimiter;
  headers: string[];
  // Each row keeps its 1-based row number in the file (the header is row 1) for "row 7: ..." messages.
  rows: { row: number; cells: string[] }[];
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Counts delimiters on the first non-empty line, outside quotes. Tab wins ties (a paste from a
// sheet), then comma, then semicolon. No delimiter at all = a single column, read as comma.
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  let sawContent = false;
  for (const ch of stripBom(text)) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      sawContent = true;
    } else if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (sawContent) break;
    } else {
      if (!inQuotes && (ch === "," || ch === ";" || ch === "\t")) counts[ch]++;
      if (ch.trim() !== "") sawContent = true;
    }
  }
  const best = (["\t", ",", ";"] as const).reduce((a, b) => (counts[b] > counts[a] ? b : a));
  return counts[best] > 0 ? best : ",";
}

function splitRecords(text: string, delimiter: Delimiter): { line: number; cells: string[] }[] {
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let startLine = 1;

  const endField = () => {
    cells.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push({ line: startLine, cells });
    cells = [];
  };

  const s = stripBom(text);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      endRecord();
      line++;
      startLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== "" || cells.length > 0) endRecord();
  return records;
}

// The first non-blank row is the header row; blank rows are dropped; short rows are padded.
export function parseDelimited(text: string): ParsedTable {
  const delimiter = detectDelimiter(text);
  const records = splitRecords(text, delimiter).filter((r) => r.cells.some((c) => c.trim() !== ""));
  if (records.length === 0) return { delimiter, headers: [], rows: [] };

  const [head, ...rest] = records;
  const headers = head.cells.map((c) => c.trim());
  const rows = rest.map((r) => ({
    row: r.line,
    cells: headers.map((_, i) => (r.cells[i] ?? "").trim()),
  }));
  return { delimiter, headers, rows };
}

// ------------------------------------------------------------------ column mapping

export type ImportTarget = "name" | "email" | "phone" | "address" | "ignore";

export const IMPORT_TARGET_LABELS: Record<ImportTarget, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  address: "Address",
  ignore: "Ignore",
};

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const HEADER_SYNONYMS: Record<Exclude<ImportTarget, "ignore">, string[]> = {
  name: ["name", "full name", "client", "client name", "customer", "customer name", "company", "company name"],
  email: ["email", "e mail", "email address", "e mail address"],
  phone: ["phone", "phone number", "mobile", "cell", "tel", "telephone"],
  address: ["address", "street", "street address"],
};

// Columns we recognise but have nowhere to put. They are mapped to Ignore, and the dialog says why.
// "total billed" and friends are another app's history: never an amount, payment or invoice.
const UNSTORED_HEADERS: Record<string, string> = {
  city: "City",
  province: "Province",
  state: "Province",
  postal: "Postal code",
  "postal code": "Postal code",
  zip: "Postal code",
  "zip code": "Postal code",
};

// Which of our fields a header looks like. Exact matches only (after lower-casing and dropping
// punctuation): a looser "contains client" rule would grab "Client Since" and similar.
export function guessTarget(header: string): ImportTarget {
  const h = normalizeHeader(header);
  for (const target of ["name", "email", "phone", "address"] as const) {
    if (HEADER_SYNONYMS[target].includes(h)) return target;
  }
  return "ignore";
}

// If a recognised column can't be stored, its label ("Phone"); otherwise null.
export function unstoredColumnLabel(header: string): string | null {
  return UNSTORED_HEADERS[normalizeHeader(header)] ?? null;
}

// One target per column; a field is claimed by the first column that looks like it.
export function guessMapping(headers: string[]): ImportTarget[] {
  const taken = new Set<ImportTarget>();
  return headers.map((h) => {
    const t = guessTarget(h);
    if (t === "ignore" || taken.has(t)) return "ignore";
    taken.add(t);
    return t;
  });
}

export interface ImportRow {
  row: number;
  name: string;
  email: string;
  phone: string;
  address: string;
}

// Builds import rows from the parsed table and the chosen mapping. Two columns mapped to the
// same field: the first one wins (the dialog also stops that, this keeps the function safe).
export function applyMapping(table: ParsedTable, mapping: ImportTarget[]): ImportRow[] {
  const index = (t: ImportTarget) => mapping.indexOf(t);
  const n = index("name");
  const e = index("email");
  const ph = index("phone");
  const a = index("address");
  return table.rows.map((r) => ({
    row: r.row,
    name: n >= 0 ? (r.cells[n] ?? "") : "",
    email: e >= 0 ? (r.cells[e] ?? "") : "",
    phone: ph >= 0 ? (r.cells[ph] ?? "") : "",
    address: a >= 0 ? (r.cells[a] ?? "") : "",
  }));
}

// ------------------------------------------------------------------ rules (also run on the server)

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export function isValidImportEmail(email: string): boolean {
  return email.length <= IMPORT_FIELD_LIMITS.email && EMAIL_RE.test(email);
}

export interface ImportProblem {
  row: number;
  reason: string;
}

export interface ImportPlan {
  toInsert: { name: string; email: string | null; phone: string | null; address: string | null }[];
  duplicates: number;
  // Rows imported WITHOUT their phone because the phone value was not valid. The row itself is fine.
  phonesIgnored: number;
  problems: ImportProblem[];
  notImportedPlanLimit: number;
}

const nameKey = (name: string) => name.trim().toLowerCase();

// Decides what happens to every row. Problem reasons never contain the row's values (they end up
// in a response and a toast; nothing a person typed is echoed or logged).
//  - A row is a duplicate when its email OR its name matches an existing client or an earlier row.
//    Name always counts, not only when the email is missing: the database holds one client per
//    lower(btrim(name)) (migration 0046), so a same-name, different-email row would fail the insert.
//  - `room` is how many more clients the plan allows (null = unlimited). Rows beyond it are counted,
//    not inserted, and they are the LAST valid new rows in file order.
export function planImport(
  existing: { name: string; email: string | null }[],
  rows: ImportRow[],
  room: number | null,
): ImportPlan {
  const seenNames = new Set(existing.map((c) => nameKey(c.name)));
  const seenEmails = new Set(existing.map((c) => (c.email ?? "").trim().toLowerCase()).filter(Boolean));

  const plan: ImportPlan = { toInsert: [], duplicates: 0, phonesIgnored: 0, problems: [], notImportedPlanLimit: 0 };

  for (const raw of rows) {
    const name = String(raw.name ?? "").trim().slice(0, IMPORT_FIELD_LIMITS.name);
    const emailRaw = String(raw.email ?? "").trim();
    const address = String(raw.address ?? "").trim().slice(0, IMPORT_FIELD_LIMITS.address);

    if (!name) {
      plan.problems.push({ row: raw.row, reason: "No name" });
      continue;
    }
    if (emailRaw && !isValidImportEmail(emailRaw)) {
      plan.problems.push({ row: raw.row, reason: "Invalid email address" });
      continue;
    }

    const emailKey = emailRaw.toLowerCase();
    if (seenNames.has(nameKey(name)) || (emailKey && seenEmails.has(emailKey))) {
      plan.duplicates++;
      continue;
    }
    seenNames.add(nameKey(name));
    if (emailKey) seenEmails.add(emailKey);

    if (room !== null && plan.toInsert.length >= room) {
      plan.notImportedPlanLimit++;
      continue;
    }
    // A bad phone never costs the client: it is dropped and counted. Only rows that import are counted.
    const phoneResult = normalizePhone(raw.phone);
    if (!phoneResult.ok) plan.phonesIgnored++;
    plan.toInsert.push({
      name,
      email: emailRaw || null,
      phone: phoneResult.ok ? phoneResult.value : null,
      address: address || null,
    });
  }
  return plan;
}

export function remainingRoom(limit: number | null, current: number): number | null {
  return limit === null ? null : Math.max(limit - current, 0);
}

export interface ImportSummary {
  imported: number;
  skippedDuplicates: number;
  skippedProblems: number;
  notImportedPlanLimit: number;
  phonesIgnored?: number;
}

export function summaryText(s: ImportSummary): string {
  const phones = s.phonesIgnored ? `, ${s.phonesIgnored} phone ignored` : "";
  return (
    `${s.imported} imported, ${s.skippedDuplicates} skipped (duplicates), ` +
    `${s.skippedProblems} skipped (problems), ${s.notImportedPlanLimit} not imported (plan limit)${phones}`
  );
}
