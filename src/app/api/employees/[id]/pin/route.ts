import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";

// Owner-side employee PIN management. Hashing and every ownership check
// live in the SQL functions (0043_employee_login.sql) - this route only
// validates shape and maps their error codes.
//
// POST   = first-time creation (409 if a PIN already exists, so an
//          employee can never be "set up" twice)
// PUT    = reset an existing PIN (404 if none)
// DELETE = remove login access entirely
// Each of reset/remove also ends that employee's active portal sessions.

function pinFrom(body: unknown): string | null {
  const pin = (body as { pin?: unknown } | null)?.pin;
  return typeof pin === "string" && /^\d{4}$/.test(pin) ? pin : null;
}

function mapError(message: string) {
  if (message.includes("EMPLOYEE_NOT_FOUND")) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }
  if (message.includes("PIN_ALREADY_SET")) {
    return NextResponse.json(
      { error: "This employee already has a PIN. Use reset instead.", code: "PIN_ALREADY_SET" },
      { status: 409 },
    );
  }
  if (message.includes("PIN_NOT_SET")) {
    return NextResponse.json({ error: "This employee has no PIN yet." }, { status: 404 });
  }
  if (message.includes("INVALID_PIN")) {
    return NextResponse.json({ error: "PIN must be 4 digits." }, { status: 400 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;
  const pin = pinFrom(await request.json().catch(() => null));
  if (!pin) return NextResponse.json({ error: "PIN must be 4 digits." }, { status: 400 });

  const { error } = await result.supabase.rpc("create_employee_pin", {
    p_employee_id: id,
    p_pin: pin,
  });
  if (error) return mapError(error.message);
  return NextResponse.json({ success: true }, { status: 201 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;
  const pin = pinFrom(await request.json().catch(() => null));
  if (!pin) return NextResponse.json({ error: "PIN must be 4 digits." }, { status: 400 });

  const { error } = await result.supabase.rpc("reset_employee_pin", {
    p_employee_id: id,
    p_pin: pin,
  });
  if (error) return mapError(error.message);
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { id } = await params;

  const { error } = await result.supabase.rpc("remove_employee_pin", { p_employee_id: id });
  if (error) return mapError(error.message);
  return NextResponse.json({ success: true });
}
