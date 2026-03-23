// app/api/chat/route.ts

import { NextResponse } from "next/server";
import {
  adminSupabase,
  createSupabaseServerClient,
} from "@/lib/supabaseServer";
import {
  bootstrapOrReadSession,
  processSessionInput,
} from "@/lib/bilan-sante/session-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isBypass() {
  return (
    process.env.DEV_BYPASS_AUTH === "1" ||
    process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "1"
  );
}

async function getUserId(): Promise<string> {
  if (isBypass()) {
    const id = process.env.DEV_BYPASS_USER_ID;
    if (!id) {
      throw new Error("Missing DEV_BYPASS_USER_ID");
    }
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

function normalizeIncomingMessage(raw: unknown) {
  return String(raw ?? "").trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId = String(body?.sessionId ?? "").trim();
    const rawMessage = normalizeIncomingMessage(body?.message);
    const objectiveDecisions = Array.isArray(body?.objectiveDecisions)
      ? body.objectiveDecisions
      : undefined;

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing sessionId" },
        { status: 400 }
      );
    }

    const userId = await getUserId();
    const admin = adminSupabase();

    const { data: session, error: sessionErr } = await admin
      .from("diagnostic_sessions")
      .select("id,user_id,extracted_text,status,phase")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionErr) {
      return NextResponse.json(
        { ok: false, error: sessionErr.message },
        { status: 500 }
      );
    }

    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 }
      );
    }

    if (!isBypass() && session.user_id !== userId) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    if (!session.extracted_text) {
      return NextResponse.json(
        { ok: false, error: "TRAME_NOT_INGESTED" },
        { status: 400 }
      );
    }

    const payload =
      !rawMessage && !objectiveDecisions
        ? await bootstrapOrReadSession({
            sessionId,
            userId,
          })
        : await processSessionInput({
            sessionId,
            userId,
            message: rawMessage,
            objectiveDecisions,
          });

    return NextResponse.json({
      ok: true,

      // compat legacy
      assistant: payload,

      // format direct nouveau noyau
      ...payload,
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const code =
      msg === "UNAUTHENTICATED"
        ? 401
        : msg === "TRAME_NOT_INGESTED"
        ? 400
        : 500;

    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Method Not Allowed" },
    { status: 405 }
  );
}