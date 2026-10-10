import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MAX_NOTES_LENGTH, parseNote } from "./document-notes.ts";

const readLf = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p.split("\\").join("/"));
  }
  return out;
}

// ---- blank to null, length ----

test("a blank or whitespace note is cleared to null, never stored as an empty string", () => {
  for (const blank of ["", "   ", "\n\t "]) {
    assert.deepEqual(parseNote(blank, "Notes to client"), { ok: true, value: null });
  }
  assert.deepEqual(parseNote(null, "Notes to client"), { ok: true, value: null });
});

test("a note that was not sent is left alone (undefined), and text is trimmed", () => {
  assert.deepEqual(parseNote(undefined, "Internal notes"), { ok: true, value: undefined });
  assert.deepEqual(parseNote("  pay in 30 days \n", "Notes to client"), { ok: true, value: "pay in 30 days" });
  // inner line breaks survive
  assert.deepEqual(parseNote("a\nb", "Notes to client"), { ok: true, value: "a\nb" });
});

test("a note over 4000 characters, or not text, is refused with the field named", () => {
  assert.equal(MAX_NOTES_LENGTH, 4000);
  assert.deepEqual(parseNote("x".repeat(4000), "Notes to client"), { ok: true, value: "x".repeat(4000) });
  const long = parseNote("x".repeat(4001), "Internal notes");
  assert.ok(!long.ok && /Internal notes must be 4000 characters or fewer/.test(long.error));
  const bad = parseNote(12, "Notes to client");
  assert.ok(!bad.ok && /Notes to client must be text/.test(bad.error));
});

// ---- save: create and edit ----

test("POST and PATCH /api/documents parse both notes and store them (blank -> null)", () => {
  const post = readLf("src/app/api/documents/route.ts");
  assert.ok(post.includes('parseNote(notesInput, "Notes to client")'));
  assert.ok(post.includes('parseNote(internalNotesInput, "Internal notes")'));
  assert.ok(post.includes("notes: notes.value ?? null"));
  assert.ok(post.includes("internal_notes: internalNotes.value ?? null"));

  const patch = readLf("src/app/api/documents/[id]/route.ts");
  assert.ok(patch.includes('parseNote(body.notes, "Notes to client")'));
  assert.ok(patch.includes('parseNote(body.internal_notes, "Internal notes")'));
  assert.ok(patch.includes("updates.notes = notes.value"));
  assert.ok(patch.includes("updates.internal_notes = internalNotes.value"));
  // client-facing notes lock with the rest of the content; the owner-only ones do not
  const keys = patch.slice(patch.indexOf("CONTENT_KEYS = ["), patch.indexOf("];", patch.indexOf("CONTENT_KEYS = [")));
  assert.ok(keys.includes('"notes"') && !keys.includes("internal_notes"));
});

test("the editor sends both notes (blank as null) and loads them back on edit", () => {
  const src = readLf("src/components/invoices/document-editor.tsx");
  assert.ok(src.includes("notes: notes.trim() || null"));
  assert.ok(src.includes("internal_notes: internalNotes.trim() || null"));
  assert.ok(src.includes('useState(document?.notes ?? "")'));
  assert.ok(src.includes('useState(document?.internal_notes ?? "")'));
  assert.ok(src.includes("Notes to client (shown on the PDF and public page)"));
  assert.ok(src.includes("Internal notes (only you see these)"));
});

test("converting an estimate to an invoice copies both notes", () => {
  const src = readLf("src/lib/estimate-conversion.ts");
  assert.ok(src.includes("notes: estimate.notes ?? null"));
  assert.ok(src.includes("internal_notes: estimate.internal_notes ?? null"));
});

test("migration 0062 adds two nullable text columns with a 4000 check, in begin/commit, no backfill", () => {
  const up = readLf("supabase/migrations/0062_document_notes.sql");
  assert.match(up, /^begin;$/m);
  assert.match(up, /^commit;$/m);
  assert.ok(up.includes("add column if not exists notes text"));
  assert.ok(up.includes("add column if not exists internal_notes text"));
  assert.ok(up.includes("between 1 and 4000"));
  assert.ok(!/^\s*update /im.test(up), "no backfill");
  assert.ok(!/not null/i.test(up.slice(up.indexOf("alter table"))), "both stay nullable");
  const down = readLf("supabase/rollbacks/0062_document_notes_rollback.sql");
  assert.match(down, /drop column if exists notes/);
  assert.match(down, /drop column if exists internal_notes/);
});

// ---- display ----

test("client-facing notes are shown after the totals on every client-facing render path", () => {
  assert.ok(readLf("src/components/public/document-paper.tsx").includes("<ClientNotes notes={notes}"));
  assert.ok(readLf("src/components/invoices/document-detail.tsx").includes("<ClientNotes notes={doc.notes}"));
  assert.ok(readLf("src/components/invoices/document-workstation.tsx").includes("<ClientNotes notes={doc.notes}"));
  const pdf = readLf("src/lib/invoice-pdf.ts");
  assert.ok(pdf.indexOf("doc.notes") > pdf.indexOf('label: "Total"'));
  for (const [file, v] of [
    ["src/app/sign/[token]/page.tsx", "estimate"],
    ["src/app/invoice/[token]/page.tsx", "invoice"],
  ]) {
    assert.ok(readLf(file).includes(`notes={${v}.notes}`), file);
  }
});

test("the owner's detail page shows internal notes in the panel, labelled Internal, and never when printed", () => {
  const panel = readLf("src/components/invoices/internal-notes-panel.tsx");
  assert.ok(panel.includes("Internal (only you see this)"));
  assert.ok(panel.includes("print:hidden"));
  assert.ok(readLf("src/components/invoices/document-detail.tsx").includes("<InternalNotesPanel"));
});

// ---- internal notes isolation ----

// The ONLY files allowed to mention internal_notes: the schema, the owner's own document routes and
// pages, the conversion that copies it, and the rules/tests about it.
const INTERNAL_NOTES_ALLOWED = new Set([
  "src/lib/database.types.ts",
  "src/lib/document-notes.ts",
  "src/lib/document-notes.test.ts",
  "src/lib/estimate-conversion.ts",
  "src/app/api/documents/route.ts",
  "src/app/api/documents/[id]/route.ts",
  "src/components/invoices/document-editor.tsx",
  "src/components/invoices/document-detail.tsx",
  // the owner-only panel, its preview-list counterpart
  "src/components/invoices/internal-notes-panel.tsx",
  "src/components/invoices/document-workstation.tsx",
]);

test("internal_notes appears only in the owner's own files - no PDF, public page, portal, email or export", () => {
  const offenders = walk("src").filter(
    (f) => !INTERNAL_NOTES_ALLOWED.has(f) && /internal_notes|internalNotes/.test(readLf(f)),
  );
  assert.deepEqual(offenders, []);
});

test("the render paths and routes named in the spec are each checked explicitly", () => {
  const paths = [
    "src/lib/invoice-pdf.ts", // the PDF
    "src/components/public/document-paper.tsx", // public sign / invoice pages
    "src/app/sign/[token]/page.tsx",
    "src/app/invoice/[token]/page.tsx",
    "src/app/api/sign/[token]/route.ts",
    "src/lib/client-portal-server.ts", // client portal
    "src/lib/client-portal.ts",
    "src/app/client/documents/[id]/page.tsx",
    "src/lib/accountant-portal-server.ts", // accountant portal
    "src/app/accountant/invoices/[id]/page.tsx",
    "src/app/api/accountant-portal/export-data/route.ts",
    "src/lib/email.ts", // every email
    "src/app/api/documents/[id]/send-email/route.ts",
    "src/lib/accountant-export.ts",
    "src/lib/csv.ts",
    "src/components/invoices/client-notes.tsx",
    "src/components/invoices/document-details-panel.tsx", // the Details card shows no notes at all
  ];
  for (const p of paths) assert.ok(!/internal_notes|internalNotes/.test(readLf(p)), p);
});

test("public pages and portals read documents by an explicit column list, never select(\"*\")", () => {
  for (const p of ["src/app/sign/[token]/page.tsx", "src/app/invoice/[token]/page.tsx"]) {
    const src = readLf(p);
    const sel = src.slice(src.indexOf('.from("documents")'), src.indexOf(".maybeSingle()"));
    assert.ok(!/select\("\*/.test(sel), `${p} must list its documents columns`);
    assert.ok(sel.includes("notes"), p);
  }
  for (const p of ["src/lib/client-portal-server.ts", "src/lib/accountant-portal-server.ts"]) {
    const src = readLf(p);
    for (const m of src.matchAll(/\.from\("documents"\)\s*\.select\(\s*"([^"]*)"/g)) {
      assert.ok(!m[1].startsWith("*"), `${p} documents select`);
    }
  }
});

test("the owner-only panel: internal notes save only internal_notes, never print, and live outside the document card", () => {
  const panel = readLf("src/components/invoices/internal-notes-panel.tsx");
  assert.ok(panel.includes("JSON.stringify({ internal_notes: text.trim() || null })"));
  assert.ok(panel.includes("router.refresh()"));
  assert.ok(panel.includes("toast.success") && panel.includes("toast.error"));
  assert.ok(panel.includes('<Card className="print:hidden">'));

  const detail = readLf("src/components/invoices/document-detail.tsx");
  // shown once: the panel in the right column; the old dashed box inside the document card is gone
  assert.ok(detail.includes("<InternalNotesPanel"));
  assert.ok(detail.includes("<DocumentDetailsPanel"));
  assert.ok(!detail.includes("border-dashed bg-muted/40"));
  assert.equal((detail.match(/doc\.internal_notes/g) ?? []).length, 1);
  // the panel comes after the document card in the DOM, so a phone stacks it below the document
  assert.ok(detail.indexOf("<InternalNotesPanel") > detail.indexOf("<ClientNotes"));
  // internal notes are not in the document card's printed content
  const card = detail.slice(detail.indexOf('<Card className="print:border-none'), detail.indexOf("<InternalNotesPanel"));
  assert.ok(!card.includes("internal_notes"));

  const details = readLf("src/components/invoices/document-details-panel.tsx");
  assert.ok(details.includes('<Card className="print:hidden">'));
});

test("the list preview shows internal notes under the client notes with the same label, not printed", () => {
  const src = readLf("src/components/invoices/document-workstation.tsx");
  assert.ok(src.indexOf("<ClientNotes") < src.indexOf("doc.internal_notes"));
  assert.match(src, /Internal <span[^>]*>\(only you see this\)/);
  assert.ok(src.slice(src.indexOf("doc.internal_notes")).includes("print:hidden"));
});

test("the notepad box: line-height equals the rule spacing, tints and rules are tokens, grows then scrolls", () => {
  const css = readLf("src/app/globals.css");
  const pad = css.slice(css.indexOf(".notepad {"));
  assert.ok(pad.includes("line-height: 1.5rem"));
  assert.ok(pad.includes("background-size: 100% 100%, 100% 1.5rem"));
  assert.ok(pad.includes("background-attachment: scroll, local"));
  assert.ok(pad.includes("field-sizing: content") && pad.includes("max-height") && pad.includes("overflow-y: auto"));
  // ruled only from lg up; light and dark tokens both defined; no images or shadows
  assert.ok(pad.includes("@media (min-width: 1024px)"));
  const tokens = css.slice(css.indexOf("--pad-paper"));
  assert.ok((tokens.match(/--pad-paper:/g) ?? []).length >= 2);
  const block = css.slice(css.indexOf("/* Owner-only \"Internal notes\" box"));
  assert.ok(!/url\(|box-shadow|font-family/.test(block));
});
