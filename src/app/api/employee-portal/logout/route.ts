import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  EMPLOYEE_COOKIE,
  createServiceClient,
  hashSessionToken,
} from "@/lib/employee-session";

export async function POST() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(EMPLOYEE_COOKIE)?.value;
  if (raw) {
    await createServiceClient()
      .from("employee_sessions")
      .delete()
      .eq("token_hash", hashSessionToken(raw));
  }
  const response = NextResponse.json({ success: true });
  response.cookies.delete(EMPLOYEE_COOKIE);
  return response;
}
