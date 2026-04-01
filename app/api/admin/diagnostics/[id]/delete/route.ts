import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabaseServer";
import { assertAdminUserOrThrow } from "@/lib/auth/access-control";

export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const adminUser = await assertAdminUserOrThrow();
    const { id: sessionId } = await context.params;

    const admin = adminSupabase();
    const { error } = await admin
      .from("diagnostic_sessions")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: adminUser.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (error) {
      throw new Error(error.message);
    }

    const { error: eventError } = await admin.from("diagnostic_events").insert({
      session_id: sessionId,
      user_id: adminUser.id,
      kind: "admin_soft_delete",
      payload: {
        deleted_by: adminUser.id,
        deleted_at: new Date().toISOString(),
      },
    });

    if (eventError) {
      console.warn("diagnostic_events insert skipped:", eventError.message);
    }

    return json({
      ok: true,
      message: "Le diagnostic a été supprimé de la vue standard.",
    });
  } catch (e: any) {
    const msg = e?.message ?? "ADMIN_DIAGNOSTIC_DELETE_FAILED";
    const status = msg === "UNAUTHENTICATED" ? 401 : 500;
    return json({ ok: false, error: msg }, status);
  }
}
