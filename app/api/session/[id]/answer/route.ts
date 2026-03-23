import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabaseServer";
import { runDiagnosticEngine } from "@/lib/diagnostic/diagnosticEngine";

export const runtime = "nodejs";

type SessionLookupRow = {
  id: string;
  user_id: string | null;
};

type SessionStateRow = {
  id: string;
  user_id: string | null;
  status: string | null;
  phase: string | null;
  dimension: number | null;
  iteration: number | null;
  question_index: number | null;
};

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await context.params;

    const body = await req.json();
    const message = String(body?.message ?? "").trim();

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing session id" },
        { status: 400 }
      );
    }

    if (!message) {
      return NextResponse.json(
        { ok: false, error: "Message vide" },
        { status: 400 }
      );
    }

    const admin = adminSupabase();

    const { data: sessionRow, error: sessionLookupError } = await admin
      .from("diagnostic_sessions")
      .select("id, user_id")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionLookupError) {
      throw new Error(
        `Session lookup failed: ${sessionLookupError.message}`
      );
    }

    if (!sessionRow) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 }
      );
    }

    const effectiveUserId = String(
      (sessionRow as SessionLookupRow).user_id ?? ""
    ).trim();

    if (!effectiveUserId) {
      throw new Error(
        "diagnostic_sessions.user_id is missing for this session"
      );
    }

    const { error: userEventError } = await admin
      .from("diagnostic_events")
      .insert({
        session_id: sessionId,
        user_id: effectiveUserId,
        kind: "CHAT_USER",
        payload: { message },
      });

    if (userEventError) {
      throw new Error(`Insert CHAT_USER failed: ${userEventError.message}`);
    }

    const result = await runDiagnosticEngine(
      sessionId,
      effectiveUserId,
      message
    );

    const { error: assistantEventError } = await admin
      .from("diagnostic_events")
      .insert({
        session_id: sessionId,
        user_id: effectiveUserId,
        kind: "CHAT_ASSISTANT",
        payload: result,
      });

    if (assistantEventError) {
      throw new Error(
        `Insert CHAT_ASSISTANT failed: ${assistantEventError.message}`
      );
    }

    const { data: updatedSession, error: updatedSessionError } = await admin
      .from("diagnostic_sessions")
      .select("id, user_id, status, phase, dimension, iteration, question_index")
      .eq("id", sessionId)
      .maybeSingle();

    if (updatedSessionError) {
      throw new Error(
        `Updated session lookup failed: ${updatedSessionError.message}`
      );
    }

    const currentIndex =
      (updatedSession as SessionStateRow | null)?.question_index ?? null;

    const activeQuestion =
      Array.isArray(result?.questions) &&
      typeof currentIndex === "number" &&
      currentIndex >= 0 &&
      currentIndex < result.questions.length
        ? result.questions[currentIndex]?.question ?? null
        : null;

    console.log("[answer route] engine result", {
      sessionId,
      effectiveUserId,
      needs_validation: result?.needs_validation ?? null,
      questions_count: Array.isArray(result?.questions)
        ? result.questions.length
        : null,
      current_question_index: currentIndex,
      active_question: activeQuestion,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      session: updatedSession
        ? {
            id: String((updatedSession as SessionStateRow).id),
            user_id: String((updatedSession as SessionStateRow).user_id ?? ""),
            status: (updatedSession as SessionStateRow).status ?? undefined,
            phase: (updatedSession as SessionStateRow).phase ?? undefined,
            dimension: (updatedSession as SessionStateRow).dimension ?? undefined,
            iteration: (updatedSession as SessionStateRow).iteration ?? undefined,
            question_index:
              (updatedSession as SessionStateRow).question_index ?? undefined,
          }
        : undefined,
    });
  } catch (e: any) {
    console.error("[answer route] error", {
      message: e?.message ?? "Engine error",
      stack: e?.stack ?? null,
    });

    return NextResponse.json(
      {
        ok: false,
        error: e?.message ?? "Engine error",
      },
      { status: 500 }
    );
  }
}