import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { generateOpaqueToken } from "@/lib/opaque-token";

// Owner-side management of one client's portal login. Pro-only. The SQL
// functions re-check ownership against auth.uid(), so a client id belonging
// to someone else just reports "not found".

const ERROR_MAP: Record<string, { message: string; status: number }> = {
  INVALID_PIN: { message: "PIN must be exactly 4 digits.", status: 400 },
  CLIENT_NOT_FOUND: { message: "Client not found.", status: 404 },
  LOGIN_NOT_FOUND: { message: "This client has no portal login.", status: 404 },
  LOGIN_ALREADY_EXISTS: { message: "This client already has a portal login.", status: 409 },
};

function failure(message: string) {
  const code = Object.keys(ERROR_MAP).find((key) => message.includes(key));
  if (code) {
    const { message: text, status } = ERROR_MAP[code];
    return NextResponse.json({ error: text }, { status });
  }
  return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const pin = typeof body?.pin === "string" ? body.pin : "";

  const linkToken = generateOpaqueToken();
  const { error } = await supabase.rpc("create_client_portal_login", {
    p_client_id: id,
    p_pin: pin,
    p_link_token: linkToken,
  });
  if (error) return failure(error.message);
  return NextResponse.json({ link_token: linkToken });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));

  if (body?.action === "reset_pin") {
    const pin = typeof body?.pin === "string" ? body.pin : "";
    const { error } = await supabase.rpc("reset_client_portal_pin", {
      p_client_id: id,
      p_pin: pin,
    });
    if (error) return failure(error.message);
    return NextResponse.json({ success: true });
  }

  if (body?.action === "regenerate_link") {
    const linkToken = generateOpaqueToken();
    const { error } = await supabase.rpc("regenerate_client_portal_link", {
      p_client_id: id,
      p_link_token: linkToken,
    });
    if (error) return failure(error.message);
    return NextResponse.json({ link_token: linkToken });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;
  const { id } = await params;

  const { error } = await supabase.rpc("remove_client_portal_login", { p_client_id: id });
  if (error) return failure(error.message);
  return NextResponse.json({ success: true });
}
