import { NextResponse } from "next/server";
import { getAccountantApiContext } from "@/lib/accountant-api";
import { signReceiptImage } from "@/lib/accountant-portal-server";

// Read-only. A short-lived signed URL for one receipt photo, issued only if
// the receipt belongs to this session's business (checked through the scoped
// reader, so another business's receipt id is just "no photo").
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await getAccountantApiContext();
  if ("response" in result) return result.response;
  const { db, admin } = result.ctx;
  const { id } = await params;

  const url = await signReceiptImage(admin, db, id);
  if (!url) return NextResponse.json({ error: "No photo for this receipt." }, { status: 404 });
  return NextResponse.json({ url });
}
