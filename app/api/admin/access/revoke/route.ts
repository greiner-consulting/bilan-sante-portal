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

export async function POST(req: Request) {
  try {
    const adminUser = await assertAdminUserOrThrow();
    const body = await req.json();
    const userId = body?.userId ? String(body.userId) : null;
    const invitationId = body?.invitationId ? String(body.invitationId) : null;

    const admin = adminSupabase();

    if (!userId && !invitationId) {
      return json({ ok: false, error: "Cible de révocation manquante." }, 400);
    }

    if (userId) {
      const { error } = await admin
        .from("entitlements")
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
          revoked_by: adminUser.id,
        })
        .eq("user_id", userId);

      if (error) {
        throw new Error(error.message);
      }

      return json({ ok: true, message: "Accès utilisateur révoqué." });
    }

    const { error } = await admin
      .from("client_access_invitations")
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
        revoked_by: adminUser.id,
      })
      .eq("id", invitationId);

    if (error) {
      throw new Error(error.message);
    }

    return json({ ok: true, message: "Invitation annulée." });
  } catch (e: any) {
    const msg = e?.message ?? "AUTH_ADMIN_REVOKE_FAILED";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return json({ ok: false, error: msg }, status);
  }
}
