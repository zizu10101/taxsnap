import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { ensureSignToken } from "@/lib/document-sign-link";
import { sendDocumentEmail } from "@/lib/email";
import { formatDocumentNumber } from "@/lib/document-number";
import { checkPdfUpload } from "@/lib/send-email-rules";

function getAppUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

// The Send menu's "Email to client": emails the document to the client on file with the PDF attached
// (the browser builds the PDF and posts it as multipart `pdf`). The recipient is ALWAYS the client's
// email read from the database - never anything from the request - and an estimate that is still open
// also carries its signature link.
//
// Sending does NOT change the document's status or anything else about it (status and posting rules
// are a separate decision); a static test pins that this file never writes to `documents`.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const { data: doc } = await supabase
    .from("documents")
    .select("id, type, document_number, total_amount, signed_at, converted_from_id, client:clients(name, email)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const client = doc.client as { name: string; email: string | null } | null;
  if (!client?.email?.trim()) {
    return NextResponse.json(
      { error: "This client has no email on file - add one on the client's page, or use Copy link." },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Attach the PDF to send." }, { status: 400 });
  }
  const file = form.get("pdf");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach the PDF to send." }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const problem = checkPdfUpload(bytes);
  if (problem) return NextResponse.json({ error: problem.error }, { status: problem.status });

  // Only an estimate that can still be signed carries the signing link.
  let signUrl: string | null = null;
  if (doc.type === "estimate" && !doc.signed_at) {
    try {
      signUrl = `${getAppUrl(request)}/sign/${await ensureSignToken(supabase, id, user.id)}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create the signature link";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name, business_email")
    .eq("id", user.id)
    .single();

  const sent = await sendDocumentEmail({
    to: client.email.trim(),
    businessName: profile?.business_name ?? null,
    replyTo: profile?.business_email?.trim() || null,
    clientName: client.name,
    type: doc.type,
    documentNumber: doc.document_number,
    totalAmount: doc.total_amount,
    signUrl,
    pdf: bytes,
    filename: `${formatDocumentNumber(doc.type, doc.document_number)}.pdf`,
  });

  if (!sent) {
    return NextResponse.json(
      { error: "Failed to send the email - try Copy link or Download PDF instead." },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, sent_to: client.email.trim() });
}
