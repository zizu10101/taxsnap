import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { limitReachedMessage, wouldExceedTotalLimit } from "@/lib/plan-limits";
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  planImport,
  remainingRoom,
  type ImportRow,
} from "@/lib/client-import";

// POST /api/clients/import - body { rows: [{ row, name, email, phone, address }] }, the dialog's already-mapped rows.
// Everything is enforced HERE (a hidden button is not a gate): size and row caps, trimming, length caps, email
// check, duplicates (against existing clients and within the file), and the Free plan's client cap.
// The user id is the session's, never the body's. The file / pasted text is never stored, and nothing a person
// typed (names, emails, addresses) is logged or echoed back in an error: failures return fixed wording only.
const SERVER_ERROR = "Could not import clients. Please try again.";
const EXISTING_PAGE = 1000;

export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const text = await request.text().catch(() => null);
  if (text === null) return NextResponse.json({ error: "Could not read the request." }, { status: 400 });
  if (Buffer.byteLength(text, "utf8") > IMPORT_MAX_BYTES) {
    return NextResponse.json({ error: "That import is over 1 MB. Split it into smaller files." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Could not read the request." }, { status: 400 });
  }
  const rawRows = (body as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return NextResponse.json({ error: "There are no rows to import." }, { status: 400 });
  }
  if (rawRows.length > IMPORT_MAX_ROWS) {
    return NextResponse.json(
      { error: `An import can have at most ${IMPORT_MAX_ROWS} rows. Split it into smaller files.` },
      { status: 400 },
    );
  }

  const rows: ImportRow[] = rawRows.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const n = typeof o.row === "number" && Number.isInteger(o.row) && o.row > 0 ? o.row : i + 2;
    return { row: n, name: str(o.name), email: str(o.email), phone: str(o.phone), address: str(o.address) };
  });

  // Existing clients (the sample client too: the unique name index covers it). Paged, because the
  // API returns at most 1000 rows per request.
  const existing: { name: string; email: string | null }[] = [];
  for (let from = 0; ; from += EXISTING_PAGE) {
    const { data, error } = await supabase
      .from("clients")
      .select("name, email")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .range(from, from + EXISTING_PAGE - 1);
    if (error) return NextResponse.json({ error: SERVER_ERROR }, { status: 500 });
    existing.push(...(data ?? []));
    if ((data ?? []).length < EXISTING_PAGE) break;
  }

  // Same cap as POST /api/clients (sample client excluded, Pro unlimited), turned into "how many more".
  const cap = await wouldExceedTotalLimit(supabase, user.id, "clients");
  const room = remainingRoom(cap.limit, cap.current);

  const plan = planImport(existing, rows, room);

  let clients: unknown[] = [];
  if (plan.toInsert.length > 0) {
    const { data, error } = await supabase
      .from("clients")
      .insert(plan.toInsert.map((c) => ({ user_id: user.id, ...c })))
      .select();
    if (error) {
      // 23505: someone created a same-named client between the check and the insert. Nothing was written.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Your clients changed while importing. Nothing was imported - please try again." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: SERVER_ERROR }, { status: 500 });
    }
    clients = data ?? [];
  }

  return NextResponse.json({
    imported: plan.toInsert.length,
    skippedDuplicates: plan.duplicates,
    skippedProblems: plan.problems.length,
    phonesIgnored: plan.phonesIgnored,
    notImportedPlanLimit: plan.notImportedPlanLimit,
    problems: plan.problems.slice(0, 5),
    limitMessage: plan.notImportedPlanLimit > 0 ? limitReachedMessage(cap, "client") : null,
    clients,
  });
}
