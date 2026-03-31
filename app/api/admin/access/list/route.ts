import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabaseServer";
import { assertAdminUserOrThrow } from "@/lib/auth/access-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  try {
    await assertAdminUserOrThrow();

    const admin = adminSupabase();

    const [{ data: entitlements, error: entitlementsError }, { data: invitations, error: invitationsError }] =
      await Promise.all([
        admin
          .from("entitlements")
          .select("user_id, email_snapshot, is_active, expires_at, granted_at, notes")
          .order("granted_at", { ascending: false }),
        admin
          .from("client_access_invitations")
          .select("id, email, access_expires_at, invited_at, is_admin, is_active, notes")
          .order("invited_at", { ascending: false }),
      ]);

    if (entitlementsError) {
      throw new Error(entitlementsError.message);
    }

    if (invitationsError) {
      throw new Error(invitationsError.message);
    }

    return json({
      ok: true,
      entitlements: entitlements ?? [],
      invitations: invitations ?? [],
    });
  } catch (e: any) {
    const msg = e?.message ?? "AUTH_ADMIN_LIST_FAILED";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return json({ ok: false, error: msg }, status);
  }
}
