import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { ONTARIO_HST_RATE } from "@/lib/hst";
import {
  wouldExceedMonthlyLimit,
  wouldExceedTotalLimit,
  limitReachedMessage,
} from "@/lib/plan-limits";
import type { DocumentStatus, DocumentType, DocumentUpdate } from "@/lib/database.types";

const DOCUMENT_TYPES: DocumentType[] = ["invoice", "estimate"];
const DOCUMENT_STATUSES: DocumentStatus[] = ["draft", "sent", "partial", "paid"];

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

interface ItemInput {
  description: string;
  quantity: number;
  unit_price: number;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;

  const { data: document, error } = await result.supabase
    .from("documents")
    .select("*, client:clients(*), job:jobs(*), payments(*), items:document_items(*)")
    .eq("id", id)
    .eq("user_id", result.user.id)
    .single();

  if (error || !document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  return NextResponse.json({ document });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const { data: existing } = await supabase
    .from("documents")
    .select("id, type, is_progress_draw, status, payments(id)")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const body = await request.json();

  // Once a document has been sent (status past draft) or has any payment
  // recorded, its actual content (amounts, line items, client, job,
  // dates) is locked - same "permanent once real money/commitment is
  // involved" principle as payouts/commission entries and the progress-
  // billing change-order log. Status transitions (draft -> sent -> paid),
  // the HST-exclusion toggle, and a progress draw's own work-completed
  // notes are lifecycle/descriptive metadata, not content, so they stay
  // editable regardless.
  const isLocked = existing.status !== "draft" || existing.payments.length > 0;
  const CONTENT_KEYS = [
    "type",
    "issue_date",
    "due_date",
    "client_id",
    "new_client",
    "job_id",
    "job_name",
    "items",
  ];
  if (isLocked && CONTENT_KEYS.some((key) => key in body)) {
    return NextResponse.json(
      {
        error:
          "This document has been sent or has payments recorded, so its content can no longer be edited.",
      },
      { status: 403 },
    );
  }
  const updates: DocumentUpdate = {
    updated_at: new Date().toISOString(),
  };

  // An estimate can be re-typed to "invoice" from this same PATCH (the
  // builder's Estimate/Invoice tabs stay editable while editing an
  // existing document) - that's a second way to turn a document into an
  // invoice besides POST /api/documents and the /convert route, so it
  // needs the same monthly cap check, but only when the type is actually
  // changing into invoice (re-saving an already-invoice document's other
  // fields shouldn't recount against the cap every time).
  if (body.type === "invoice" && existing.type !== "invoice") {
    const monthlyCheck = await wouldExceedMonthlyLimit(supabase, user.id, "invoices");
    if (monthlyCheck.exceeded) {
      return NextResponse.json(
        {
          error: limitReachedMessage(monthlyCheck, "invoice", "this month"),
          code: "FREE_LIMIT_REACHED",
        },
        { status: 403 },
      );
    }
  }

  if (body.type && DOCUMENT_TYPES.includes(body.type)) updates.type = body.type;
  if (body.status && DOCUMENT_STATUSES.includes(body.status)) {
    updates.status = body.status;
  }
  if (body.issue_date) updates.issue_date = body.issue_date;
  if (body.due_date !== undefined) updates.due_date = body.due_date || null;
  if (typeof body.excluded_from_hst === "boolean") {
    updates.excluded_from_hst = body.excluded_from_hst;
  }
  // is_progress_draw/draw_number are deliberately not editable here -
  // flipping whether a document counts as a draw after creation would
  // desync the job-scoped draw_number sequence (see lib/document-
  // number.ts). Only the free-text work-completed fields can change.
  if (existing.is_progress_draw) {
    if (body.draw_description !== undefined) {
      updates.draw_description = body.draw_description?.trim() || null;
    }
    if (body.draw_percent_complete !== undefined) {
      updates.draw_percent_complete =
        body.draw_percent_complete === null ? null : Number(body.draw_percent_complete);
    }
  }

  let clientId: string | undefined = body.client_id ?? undefined;
  if (!clientId && body.new_client?.name?.trim()) {
    // Same cap as the inline-create path in POST /api/documents - editing
    // a document is a second real way to create a client row via
    // "+ Add new client".
    const clientTotalCheck = await wouldExceedTotalLimit(supabase, user.id, "clients");
    if (clientTotalCheck.exceeded) {
      return NextResponse.json(
        {
          error: limitReachedMessage(clientTotalCheck, "client"),
          code: "FREE_LIMIT_REACHED",
        },
        { status: 403 },
      );
    }

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .insert({
        user_id: user.id,
        name: body.new_client.name.trim(),
        email: body.new_client.email?.trim() || null,
        address: body.new_client.address?.trim() || null,
      })
      .select()
      .single();

    if (clientError) {
      return NextResponse.json({ error: clientError.message }, { status: 500 });
    }
    clientId = client.id;
  }
  if (clientId !== undefined) updates.client_id = clientId;

  // Job link is optional and clearable (unlike client) - an explicit
  // `job_id: null` un-links the document, so this checks for the key's
  // presence rather than truthiness.
  let jobId: string | null | undefined;
  if ("job_id" in body) {
    jobId = body.job_id ?? null;
  } else if (body.job_name?.trim()) {
    const name = body.job_name.trim();
    const { data: existingJob } = await supabase
      .from("jobs")
      .select("id")
      .eq("user_id", user.id)
      .eq("name", name)
      .maybeSingle();

    if (existingJob) {
      jobId = existingJob.id;
    } else {
      const { data: newJob, error: newJobError } = await supabase
        .from("jobs")
        .insert({ user_id: user.id, name })
        .select("id")
        .single();
      if (newJobError) {
        return NextResponse.json({ error: newJobError.message }, { status: 500 });
      }
      jobId = newJob.id;
    }
  }
  if (jobId) {
    // A FK constraint alone only checks that the row exists, not that it
    // belongs to this user - re-verify explicitly whenever an id came
    // straight from the request rather than the find-or-create above
    // (which is already scoped to user_id).
    if ("job_id" in body) {
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .select("id")
        .eq("id", jobId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (jobError || !job) {
        return NextResponse.json({ error: "Job not found." }, { status: 404 });
      }
    }
  }
  if (jobId !== undefined) updates.job_id = jobId;

  const cleanItems: ItemInput[] | null = Array.isArray(body.items)
    ? body.items.filter((i: ItemInput) => i?.description?.trim())
    : null;

  if (cleanItems) {
    if (cleanItems.length === 0) {
      return NextResponse.json(
        { error: "At least one line item is required." },
        { status: 400 },
      );
    }
    const subtotal = round2(
      cleanItems.reduce(
        (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0),
        0,
      ),
    );
    const hstAmount = round2(subtotal * ONTARIO_HST_RATE);
    updates.subtotal = subtotal;
    updates.hst_amount = hstAmount;
    updates.total_amount = round2(subtotal + hstAmount);
  }

  const { data: document, error: updateError } = await supabase
    .from("documents")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*, client:clients(*), job:jobs(*), payments(*)")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  let items = null;
  if (cleanItems) {
    await supabase.from("document_items").delete().eq("document_id", id);
    const { data: insertedItems, error: itemsError } = await supabase
      .from("document_items")
      .insert(
        cleanItems.map((item, index) => ({
          document_id: id,
          description: item.description.trim(),
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          sort_order: index,
        })),
      )
      .select();

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }
    items = insertedItems;
  } else {
    const { data: existingItems } = await supabase
      .from("document_items")
      .select("*")
      .eq("document_id", id)
      .order("sort_order", { ascending: true });
    items = existingItems ?? [];
  }

  return NextResponse.json({ document: { ...document, items } });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;
  const { id } = await params;

  const { data: existing } = await supabase
    .from("documents")
    .select("id, status, payments(id)")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  // Same lock as PATCH above - a draft with no payments can still be
  // freely deleted; anything sent or with payments recorded is a real
  // financial record and stays permanent.
  if (existing.status !== "draft" || existing.payments.length > 0) {
    return NextResponse.json(
      {
        error:
          "This document has been sent or has payments recorded, so it can no longer be deleted.",
      },
      { status: 403 },
    );
  }

  const { error } = await supabase.from("documents").delete().eq("id", id).eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
