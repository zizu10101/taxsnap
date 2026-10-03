import { NextResponse } from "next/server";
import { getAccountantApiContext } from "@/lib/accountant-api";
import { listAccountantExpenses, loadAccountantBusiness } from "@/lib/accountant-portal-server";

const SIGNED_URL_EXPIRY_SECONDS = 60;

// Read-only. Short-lived signed URLs for the export bundle's files, minted
// right before the browser fetches them. Receipt photo paths are only signed
// if they appear on one of THIS business's receipts - a made-up or foreign path
// is silently skipped - and the logo is always the business's own.
//
//   POST { "logo": true }            -> { logoUrl }
//   POST { "paths": ["...", ...] }   -> { urls: { path: signedUrl } }
export async function POST(request: Request) {
  const result = await getAccountantApiContext();
  if ("response" in result) return result.response;
  const { db, admin, userId } = result.ctx;

  const body = await request.json().catch(() => ({}));

  if (body?.logo === true) {
    const { logoPath } = await loadAccountantBusiness(admin, userId);
    if (!logoPath) return NextResponse.json({ logoUrl: null });
    const { data } = await admin.storage
      .from("logos")
      .createSignedUrl(logoPath, SIGNED_URL_EXPIRY_SECONDS);
    return NextResponse.json({ logoUrl: data?.signedUrl ?? null });
  }

  const requested: string[] = Array.isArray(body?.paths)
    ? body.paths.filter((p: unknown): p is string => typeof p === "string")
    : [];
  if (requested.length === 0) return NextResponse.json({ urls: {} });

  const owned = new Set(
    (await listAccountantExpenses(db)).map((r) => r.image_url).filter((p): p is string => !!p),
  );
  const allowed = requested.filter((p) => owned.has(p));
  if (allowed.length === 0) return NextResponse.json({ urls: {} });

  const { data: signed } = await admin.storage
    .from("receipts")
    .createSignedUrls(allowed, SIGNED_URL_EXPIRY_SECONDS);

  const urls: Record<string, string> = {};
  for (const entry of signed ?? []) {
    if (!entry.error && entry.signedUrl && entry.path) urls[entry.path] = entry.signedUrl;
  }
  return NextResponse.json({ urls });
}
