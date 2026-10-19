import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import type { ProfileUpdate } from "@/lib/database.types";

export async function PATCH(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  const body = await request.json();
  const {
    business_name,
    business_address,
    business_phone,
    business_email,
    business_number,
    skipped,
  } = body ?? {};

  const updates: ProfileUpdate = {};
  if (business_name !== undefined) updates.business_name = business_name?.trim() || null;
  if (business_address !== undefined) {
    updates.business_address = business_address?.trim() || null;
  }
  if (business_phone !== undefined) updates.business_phone = business_phone?.trim() || null;
  if (business_email !== undefined) updates.business_email = business_email?.trim() || null;
  if (business_number !== undefined) {
    const bn = typeof business_number === "string" ? business_number.trim() : "";
    if (bn.length > 40) {
      return NextResponse.json({ error: "The HST/BN number is too long (40 characters at most)." }, { status: 400 });
    }
    updates.business_number = bn || null;
  }
  if (skipped) updates.business_profile_skipped = true;
  if (business_name?.trim()) updates.business_profile_skipped = false;

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id)
    .select(
      "business_name, business_address, business_phone, business_email, business_number, business_profile_skipped, logo_url",
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
