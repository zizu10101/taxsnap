// An invoice has a date it is DUE; an estimate has a date its price is
// good until ("Valid until"). Same column (documents.due_date), different
// meaning, so the wording follows the document type everywhere it is shown.

export type DatedDocumentType = "invoice" | "estimate";

export function dueDateLabel(type: DatedDocumentType): string {
  return type === "estimate" ? "Valid until" : "Due date";
}
