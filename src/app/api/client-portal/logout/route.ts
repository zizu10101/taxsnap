import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  CLIENT_COOKIE,
  createServiceClient,
  hashSessionToken,
} from "@/lib/client-session";

export async function POST() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(CLIENT_COOKIE)?.value;
  if (raw) {
    await createServiceClient()
      .from("client_sessions")
      .delete()
      .eq("token_hash", hashSessionToken(raw));
  }
  const response = NextResponse.json({ success: true });
  response.cookies.delete(CLIENT_COOKIE);
  return response;
}
