import { NextResponse } from "next/server";
import { requireClientSession } from "@/lib/client-session";
import { loadPortalBusiness, loadPortalDocument } from "@/lib/client-portal-server";

// Read-only. Feeds the portal's "Download PDF" button: it returns just the
// whitelisted document fields plus the business header, and the browser
// builds the PDF with the same generateDocumentPdf the owner uses.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireClientSession();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { session, supabase } = result;
  const { id } = await params;

  const detail = await loadPortalDocument(supabase, session, id);
  if (!detail) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const { business, logoUrl } = await loadPortalBusiness(supabase, session);
  return NextResponse.json({ document: detail.document, business, logoUrl });
}
