import { NextResponse } from "next/server";
import { getAccountantApiContext } from "@/lib/accountant-api";
import { getAccountantDocument, loadAccountantBusiness } from "@/lib/accountant-portal-server";

// Read-only. Feeds the portal's "Download PDF" button for one invoice or
// estimate: the whitelisted document fields plus the business header, and a
// short-lived signed URL for the logo. The browser builds the PDF with the
// same generateDocumentPdf the owner uses.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await getAccountantApiContext();
  if ("response" in result) return result.response;
  const { db, admin, userId } = result.ctx;
  const { id } = await params;

  const detail = await getAccountantDocument(db, id);
  if (!detail) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const { business, logoPath } = await loadAccountantBusiness(admin, userId);
  let logoUrl: string | null = null;
  if (logoPath) {
    const { data } = await admin.storage.from("logos").createSignedUrl(logoPath, 60 * 10);
    logoUrl = data?.signedUrl ?? null;
  }
  return NextResponse.json({ document: detail.document, business, logoUrl });
}
