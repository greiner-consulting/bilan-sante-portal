import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import {
  entitlementIsUsable,
  getActiveEntitlementForUser,
  isAdminUser,
  syncPendingInvitationForUser,
} from "@/lib/auth/access-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return json({ ok: false, error: "UNAUTHENTICATED" }, 401);
    }

    await syncPendingInvitationForUser({
      userId: user.id,
      email: user.email ?? null,
    });

    const entitlement = await getActiveEntitlementForUser(user.id);
    const admin = await isAdminUser(user.id);

    return json({
      ok: true,
      userId: user.id,
      email: user.email ?? null,
      isAdmin: admin,
      hasEntitlement: entitlementIsUsable(entitlement),
    });
  } catch (e: any) {
    return json(
      { ok: false, error: e?.message ?? "AUTH_SYNC_INVITATION_FAILED" },
      500
    );
  }
}
