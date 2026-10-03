import { NextResponse } from "next/server";
import { requireProUser } from "@/lib/require-pro";
import { generateOpaqueToken } from "@/lib/opaque-token";

// Owner-side management of the business's one accountant login. Pro-only
// (Reports is a Pro feature). The SQL functions are keyed on auth.uid(), so an
// owner can only ever touch their own login.

const ERROR_MAP: Record<string, { message: string; status: number }> = {
  INVALID_PIN: { message: "PIN must be exactly 4 digits.", status: 400 },
  LOGIN_NOT_FOUND: { message: "There is no accountant login to change.", status: 404 },
  LOGIN_ALREADY_EXISTS: { message: "An accountant login already exists.", status: 409 },
};

function failure(message: string) {
  const code = Object.keys(ERROR_MAP).find((key) => message.includes(key));
  if (code) {
    const { message: text, status } = ERROR_MAP[code];
    return NextResponse.json({ error: text }, { status });
  }
  return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
}

export async function POST(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const body = await request.json().catch(() => ({}));
  const pin = typeof body?.pin === "string" ? body.pin : "";

  const linkToken = generateOpaqueToken();
  const { error } = await supabase.rpc("create_accountant_login", {
    p_pin: pin,
    p_link_token: linkToken,
  });
  if (error) return failure(error.message);
  return NextResponse.json({ link_token: linkToken });
}

export async function PATCH(request: Request) {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const body = await request.json().catch(() => ({}));

  if (body?.action === "reset_pin") {
    const pin = typeof body?.pin === "string" ? body.pin : "";
    const { error } = await supabase.rpc("reset_accountant_pin", { p_pin: pin });
    if (error) return failure(error.message);
    return NextResponse.json({ success: true });
  }

  if (body?.action === "regenerate_link") {
    const linkToken = generateOpaqueToken();
    const { error } = await supabase.rpc("regenerate_accountant_link", {
      p_link_token: linkToken,
    });
    if (error) return failure(error.message);
    return NextResponse.json({ link_token: linkToken });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export async function DELETE() {
  const result = await requireProUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase } = result;

  const { error } = await supabase.rpc("remove_accountant_login");
  if (error) return failure(error.message);
  return NextResponse.json({ success: true });
}
