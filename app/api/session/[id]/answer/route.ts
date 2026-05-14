import { NextResponse } from "next/server";
import {
  adminSupabase,
  createSupabaseServerClient,
} from "@/lib/supabaseServer";
import {
  bootstrapOrReadDiagnosticSession,
  submitDiagnosticSessionMessage,
} from "@/lib/diagnostic/sessionAdapter";

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

type SessionLookupRow = {
  id: string;
  user_id: string | null;
};

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;

    const message = String(body?.message ?? "").trim();

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing session id" },
        { status: 400 }
      );
    }

    const effectiveUserId = await getEffectiveUserId();
    const admin = adminSupabase();

    const { data: sessionRow, error: sessionLookupError } = await admin
      .from("diagnostic_sessions")
      .select("id, user_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionLookupError) {
      throw new Error(`Session lookup failed: ${sessionLookupError.message}`);
    }

    if (!sessionRow) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 }
      );
    }

    if (
      !isBypass() &&
      String((sessionRow as SessionLookupRow).user_id ?? "") !== effectiveUserId
    ) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    const payload = message
      ? await submitDiagnosticSessionMessage({
          sessionId,
          userId: effectiveUserId,
          message,
        })
      : await bootstrapOrReadDiagnosticSession({
          sessionId,
          userId: effectiveUserId,
        });

    return NextResponse.json({
      ok: true,
      ...payload,
    });
  } catch (e: any) {
    const msg = e?.message ?? "Engine error";
    const code =
      msg === "UNAUTHENTICATED"
        ? 401
        : msg === "TRAME_NOT_INGESTED"
        ? 400
        : msg === "Session not found"
        ? 404
        : 500;

    return NextResponse.json(
      {
        ok: false,
        error: msg,
      },
      { status: code }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Method Not Allowed" },
    { status: 405 }
  );
}