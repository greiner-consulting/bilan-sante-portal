import { NextResponse } from "next/server";
import {
  getAuthenticatedUserOrThrow,
  isAdminUser,
} from "@/lib/auth/access-control";
import { adminSupabase } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const { id: sessionId } = await context.params;
    const user = await getAuthenticatedUserOrThrow();
    const admin = adminSupabase();

    const { data: session, error: loadError } = await admin
      .from("diagnostic_sessions")
      .select("id, user_id, deleted_at")
      .eq("id", sessionId)
      .maybeSingle();

    if (loadError) {
      throw new Error(loadError.message);
    }

    if (!session) {
      return json({ ok: false, error: "Session not found" }, 404);
    }

    const adminUser = await isAdminUser(user.id);
    const ownerId = String(session.user_id ?? "");

    if (!adminUser && ownerId !== user.id) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    if (session.deleted_at) {
      return json({ ok: true, alreadyDeleted: true });
    }

    const patch = {
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      updated_at: new Date().toISOString(),
      status: "deleted",
    };

    const { error: updateError } = await admin
      .from("diagnostic_sessions")
      .update(patch)
      .eq("id", sessionId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return json({ ok: true });
  } catch (error: any) {
    const message = error?.message ?? "SESSION_DELETE_FAILED";
    const status = message === "UNAUTHENTICATED" ? 401 : 500;
    return json({ ok: false, error: message }, status);
  }
}
