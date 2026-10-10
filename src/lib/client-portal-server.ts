import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ClientSessionContext } from "@/lib/client-session";
import {
  PORTAL_DOCUMENT_COLUMNS,
  invoiceBalance,
  isIssuedToClient,
  toPortalRow,
  type PortalDocumentRow,
} from "@/lib/client-portal";
import type { PdfDocument } from "@/lib/invoice-pdf";

type Service = SupabaseClient<Database>;

export interface PortalBusiness {
  name: string | null;
  email: string;
  phone: string | null;
  address: string | null;
}

// Every query here filters on BOTH user_id and client_id taken from the
// verified session row - never from a request parameter - and only ever
// selects the explicit column lists below.

export async function loadPortalBusiness(
  supabase: Service,
  session: ClientSessionContext,
): Promise<{ business: PortalBusiness; logoUrl: string | null }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("business_name, business_email, business_phone, business_address, logo_url")
    .eq("id", session.userId)
    .single();

  let logoUrl: string | null = null;
  if (profile?.logo_url) {
    const { data: signed } = await supabase.storage
      .from("logos")
      .createSignedUrl(profile.logo_url, 60 * 60);
    logoUrl = signed?.signedUrl ?? null;
  }

  return {
    business: {
      name: profile?.business_name ?? null,
      email: profile?.business_email ?? "",
      phone: profile?.business_phone ?? null,
      address: profile?.business_address ?? null,
    },
    logoUrl,
  };
}

export async function listPortalDocuments(
  supabase: Service,
  session: ClientSessionContext,
): Promise<PortalDocumentRow[]> {
  const { data } = await supabase
    .from("documents")
    .select(PORTAL_DOCUMENT_COLUMNS)
    .eq("user_id", session.userId)
    .eq("client_id", session.clientId)
    .neq("status", "draft")
    .order("issue_date", { ascending: false })
    .order("document_number", { ascending: false });

  return ((data ?? []) as unknown as Parameters<typeof toPortalRow>[0][])
    .map(toPortalRow)
    .filter((row): row is PortalDocumentRow => row !== null);
}

// One document, only if it belongs to this client and has been issued.
// Anything else (someone else's id, a draft, a made-up id) is null, which
// callers turn into a plain 404 so a client can't probe for what exists.
export async function loadPortalDocument(
  supabase: Service,
  session: ClientSessionContext,
  id: string,
): Promise<PortalDetailResult | null> {
  const { data } = await supabase
    .from("documents")
    .select(
      "id, type, status, document_number, issue_date, due_date, subtotal, hst_amount, total_amount, is_progress_draw, draw_number, place_of_work, payments(amount), items:document_items(id, name, description, unit, quantity, unit_price, sort_order), client:clients(name, email, address)",
    )
    .eq("id", id)
    .eq("user_id", session.userId)
    .eq("client_id", session.clientId)
    .maybeSingle();

  if (!data || !isIssuedToClient(data.status)) return null;

  const items = [...(data.items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const paid =
    data.type === "invoice"
      ? Math.round(((data.payments ?? []).reduce((s, p) => s + p.amount, 0) + Number.EPSILON) * 100) / 100
      : 0;

  return {
    document: {
      id: data.id,
      type: data.type,
      status: data.status,
      document_number: data.document_number,
      issue_date: data.issue_date,
      due_date: data.due_date,
      subtotal: data.subtotal,
      hst_amount: data.hst_amount,
      total_amount: data.total_amount,
      is_progress_draw: data.is_progress_draw,
      draw_number: data.draw_number,
      // Work-completed notes and percent-complete are job progress detail
      // that the shared invoice view doesn't show either.
      draw_percent_complete: null,
      draw_description: null,
      items: items.map(({ name, description, unit, quantity, unit_price }, index) => ({
        id: `${data.id}-${index}`,
        name,
        description,
        unit,
        quantity,
        unit_price,
      })),
      // The address of the work is printed on the client's own document, not job data.
      place_of_work: data.place_of_work,
      client: data.client as PdfDocument["client"],
    },
    paid,
    balance: data.type === "invoice" ? invoiceBalance(data.total_amount, paid) : 0,
  };
}

export type PortalDetailResult = {
  document: PdfDocument & {
    id: string;
    items: {
      id: string;
      name: string | null;
      description: string;
      unit: string | null;
      quantity: number;
      unit_price: number;
    }[];
  };
  paid: number;
  balance: number;
};
