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

    if (!userId && !invitationId) {
      return json({ ok: false, error: "Cible de suppression manquante." }, 400);
    }

    const admin = adminSupabase();

    if (userId) {
      if (userId === adminUser.id) {
        return json(
          {
            ok: false,
            error: "Vous ne pouvez pas supprimer votre propre accès depuis cette interface.",
          },
          400
        );
      }

      const { error: entitlementError } = await admin
        .from("entitlements")
        .delete()
        .eq("user_id", userId);

      if (entitlementError) {
        throw new Error(entitlementError.message);
      }

      const { error: adminUserError } = await admin
        .from("admin_users")
        .delete()
        .eq("user_id", userId);

      if (adminUserError) {
        throw new Error(adminUserError.message);
      }

      return json({
        ok: true,
        message: "Accès supprimé définitivement.",
      });
    }

    const { error: invitationError } = await admin
      .from("client_access_invitations")
      .delete()
      .eq("id", invitationId);

    if (invitationError) {
      throw new Error(invitationError.message);
    }

    return json({
      ok: true,
      message: "Invitation supprimée définitivement.",
    });
  } catch (e: any) {
    const msg = e?.message ?? "AUTH_ADMIN_REVOKE_FAILED";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return json({ ok: false, error: msg }, status);
  }
}