import { NextResponse } from "next/server";

// Maps the error codes raised by the owner_* time-session SQL functions
// (0043_employee_login.sql) to user-facing responses.
export function timeSessionErrorResponse(message: string) {
  if (message.includes("SESSION_NOT_FOUND")) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (message.includes("ALREADY_CLOSED")) {
    return NextResponse.json({ error: "This session is already closed." }, { status: 409 });
  }
  if (message.includes("INVALID_RANGE")) {
    return NextResponse.json({ error: "The end time must be after the start time." }, { status: 400 });
  }
  if (message.includes("FUTURE_END")) {
    return NextResponse.json({ error: "Times can't be in the future." }, { status: 400 });
  }
  if (message.includes("OVERLAP")) {
    return NextResponse.json(
      { error: "That overlaps another session for this employee." },
      { status: 409 },
    );
  }
  if (message.includes("USE_CLOSE")) {
    return NextResponse.json(
      { error: "To give an open session an end time, close it instead." },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
