import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ACCOUNTANT_COOKIE,
  createServiceClient,
  hashSessionToken,
} from "@/lib/accountant-session";

export async function POST() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ACCOUNTANT_COOKIE)?.value;
  if (raw) {
    await createServiceClient()
      .from("accountant_sessions")
      .delete()
      .eq("token_hash", hashSessionToken(raw));
  }
  const response = NextResponse.json({ success: true });
  response.cookies.delete(ACCOUNTANT_COOKIE);
  return response;
}
