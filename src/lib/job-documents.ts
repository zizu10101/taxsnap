// Splits the documents linked to a job into the three groups its page lists: estimates, ordinary
// invoices, and progress draws (which are invoices too, but are listed on their own so they aren't
// shown twice). Pure; the page already fetches these rows, so there is no extra query.

export interface JobDocumentRow {
  id: string;
  type: "invoice" | "estimate";
  status: string;
  document_number: number;
  total_amount: number;
  issue_date: string;
  is_progress_draw: boolean;
  draw_number: number | null;
  // Any payment recorded against it (blocks deleting the job).
  has_payments?: boolean;
}

export interface JobDocumentGroups<T extends JobDocumentRow> {
  estimates: T[];
  invoices: T[];
  draws: T[];
}

export function groupJobDocuments<T extends JobDocumentRow>(docs: T[]): JobDocumentGroups<T> {
  const byNewest = (a: T, b: T) =>
    a.issue_date === b.issue_date ? b.document_number - a.document_number : a.issue_date < b.issue_date ? 1 : -1;
  const estimates = docs.filter((d) => d.type === "estimate").sort(byNewest);
  const invoices = docs.filter((d) => d.type === "invoice" && !d.is_progress_draw).sort(byNewest);
  const draws = docs
    .filter((d) => d.type === "invoice" && d.is_progress_draw)
    .sort((a, b) => (a.draw_number ?? 0) - (b.draw_number ?? 0) || a.document_number - b.document_number);
  return { estimates, invoices, draws };
}
