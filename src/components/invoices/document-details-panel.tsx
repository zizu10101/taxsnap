import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dueDateLabel } from "@/lib/document-labels";
import type { DocumentWithRelations } from "@/lib/database.types";

function formatDate(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// The "Details" card in the detail page's right-hand panel: the facts about the document at a glance.
// Owner-only chrome, never printed. It shows no notes of any kind.
export function DocumentDetailsPanel({ doc }: { doc: DocumentWithRelations }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: "Job",
      value: doc.job ? (
        <Link href={`/dashboard/jobs/${doc.job.id}`} className="underline underline-offset-2 hover:text-primary">
          {doc.job.name}
        </Link>
      ) : null,
    },
    { label: "Place of work", value: doc.place_of_work || null },
    {
      label: "Client",
      value: doc.client ? (
        <Link href="/dashboard/clients" className="underline underline-offset-2 hover:text-primary">
          {doc.client.name}
        </Link>
      ) : null,
    },
    { label: "Issue date", value: formatDate(doc.issue_date) },
    { label: dueDateLabel(doc.type), value: doc.due_date ? formatDate(doc.due_date) : null },
    { label: "Status", value: <span className="capitalize">{doc.status}</span> },
  ];

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-4">
              <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 text-right break-words">{row.value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
