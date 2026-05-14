import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  adminSupabase,
} from "@/lib/supabaseServer";
import { readDiagnosticSessionContext } from "@/lib/diagnostic/sessionAdapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isBypass() {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}

async function getEffectiveUserId(): Promise<string> {
  if (isBypass()) {
    const id = process.env.DEV_BYPASS_USER_ID;
    if (!id) throw new Error("Missing DEV_BYPASS_USER_ID");
    return id;
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }

  return user.id;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = String(searchParams.get("id") ?? "").trim();

    if (!sessionId) {
      return json({ ok: false, error: "Missing id" }, 400);
    }

    const effectiveUserId = await getEffectiveUserId();
    const admin = adminSupabase();

    const { data: sessionOwner, error: ownerErr } = await admin
      .from("diagnostic_sessions")
      .select("id, user_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (ownerErr) {
      return json({ ok: false, error: ownerErr.message }, 500);
    }

    if (!sessionOwner) {
      return json({ ok: false, error: "Session not found" }, 404);
    }

    if (
      !isBypass() &&
      String(sessionOwner.user_id ?? "") !== effectiveUserId
    ) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    const payload = await readDiagnosticSessionContext({
  sessionId,
  userId: effectiveUserId,
  })
    return json(payload, 200);
  } catch (e: any) {
    const msg = e?.message ?? "Context error";

    const code =
      msg === "UNAUTHENTICATED"
        ? 401
        : msg === "Session not found"
        ? 404
        : 500;

    return json(
      {
        ok: false,
        error: msg,
      },
      code
    );
  }
}

export async function POST() {
  return json({ ok: false, error: "Method Not Allowed" }, 405);
}