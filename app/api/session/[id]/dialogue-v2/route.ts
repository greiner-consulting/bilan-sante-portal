import { NextResponse } from "next/server";
import {
  adminSupabase,
  createSupabaseServerClient,
} from "@/lib/supabaseServer";
import { runDiagnosticEngine } from "@/lib/diagnostic/diagnosticEngine";
import {
  CONTEXT_INTAKE_PHASE,
  CONTEXT_INTAKE_PROMPT,
  CONTEXT_SOURCE_HEADER,
} from "@/lib/diagnostic/conversationProtocol";

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

  if (!user) throw new Error("UNAUTHENTICATED");
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

async function loadOwnedSession(sessionId: string, userId: string) {
  const admin = adminSupabase();
  const { data, error } = await admin
    .from("diagnostic_sessions")
    .select(
      "id,user_id,status,phase,dimension,iteration,question_index,extracted_text,question_batch_json,updated_at,created_at"
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Session not found");
  if (!isBypass() && String(data.user_id ?? "") !== userId) {
    throw new Error("FORBIDDEN");
  }

  return data;
}

async function loadHistory(sessionId: string) {
  const admin = adminSupabase();
  const { data, error } = await admin
    .from("diagnostic_events")
    .select("id,kind,payload,created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(800);

  if (error) return [];
  return data ?? [];
}

function mapPhase(row: any) {
  if (!row?.extracted_text) return CONTEXT_INTAKE_PHASE;
  if (row.phase === "dimension_questions") return "dimension_iteration";
  if (row.phase === "iteration_validation") return "iteration_validation";
  if (row.phase === "final_objectives_validation") return "final_objectives_validation";
  if (row.phase === "report_ready" || row.phase === "diagnostic_complete") return "report_ready";
  if (row.phase === "completed") return "completed";
  return row.phase || "dimension_iteration";
}

function sessionPayload(row: any) {
  return {
    id: row.id,
    status: row.status ?? "in_progress",
    phase: mapPhase(row),
    dimension: row.dimension ?? null,
    iteration: row.iteration ?? null,
    question_index: Number(row.question_index ?? 0),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

async function initializeConversationSession(sessionId: string) {
  const admin = adminSupabase();
  const { error } = await admin
    .from("diagnostic_sessions")
    .update({
      status: "in_progress",
      phase: CONTEXT_INTAKE_PHASE,
      dimension: null,
      iteration: null,
      question_index: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) throw new Error(error.message);
}

async function ingestInitialContext(params: {
  sessionId: string;
  userId: string;
  message: string;
}) {
  const admin = adminSupabase();
  const now = new Date().toISOString();
  const extractedText = `${CONTEXT_SOURCE_HEADER}\n\n${params.message}`;

  const { error: eventError } = await admin.from("diagnostic_events").insert({
    session_id: params.sessionId,
    user_id: params.userId,
    kind: "CHAT_USER",
    payload: {
      phase: CONTEXT_INTAKE_PHASE,
      message: params.message,
      theme: "Histoire & résultats",
    },
  });

  if (eventError) throw new Error(eventError.message);

  const { error: updateError } = await admin
    .from("diagnostic_sessions")
    .update({
      status: "in_progress",
      phase: "dimension_questions",
      dimension: 1,
      iteration: 1,
      question_index: 0,
      extracted_text: extractedText,
      question_batch_json: [],
      coverage_json: {},
      global_analysis_json: {},
      diagnostic_result_json: {},
      final_objectives_json: {},
      consolidation_json: [],
      updated_at: now,
    })
    .eq("id", params.sessionId);

  if (updateError) throw new Error(updateError.message);

  const assistant = await runDiagnosticEngine(params.sessionId, params.userId, "");
  const row = await loadOwnedSession(params.sessionId, params.userId);

  return {
    assistant_message: assistant.assistant_message,
    questions: assistant.questions,
    needs_validation: assistant.needs_validation,
    session: sessionPayload(row),
    history: await loadHistory(params.sessionId),
  };
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await context.params;
    const userId = await getEffectiveUserId();
    let row = await loadOwnedSession(sessionId, userId);

    if (!row.extracted_text && row.phase !== CONTEXT_INTAKE_PHASE) {
      await initializeConversationSession(sessionId);
      row = await loadOwnedSession(sessionId, userId);
    }

    if (!row.extracted_text) {
      return json({
        ok: true,
        assistant_message: CONTEXT_INTAKE_PROMPT,
        questions: [],
        needs_validation: false,
        session: sessionPayload(row),
        history: await loadHistory(sessionId),
      });
    }

    const assistant = await runDiagnosticEngine(sessionId, userId, "");
    row = await loadOwnedSession(sessionId, userId);

    return json({
      ok: true,
      assistant_message: assistant.assistant_message,
      questions: assistant.questions,
      needs_validation: assistant.needs_validation,
      session: sessionPayload(row),
      history: await loadHistory(sessionId),
    });
  } catch (error: any) {
    const message = error?.message ?? "Dialogue context error";
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "FORBIDDEN"
        ? 403
        : message === "Session not found"
        ? 404
        : 500;
    return json({ ok: false, error: message }, status);
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await context.params;
    const userId = await getEffectiveUserId();
    const body = (await req.json()) as Record<string, unknown>;
    const message = String(body?.message ?? "").trim();

    if (!message) return json({ ok: false, error: "Message vide" }, 400);

    const row = await loadOwnedSession(sessionId, userId);

    if (!row.extracted_text) {
      const payload = await ingestInitialContext({ sessionId, userId, message });
      return json({ ok: true, ...payload });
    }

    const assistant = await runDiagnosticEngine(sessionId, userId, message);
    const nextRow = await loadOwnedSession(sessionId, userId);

    return json({
      ok: true,
      assistant_message: assistant.assistant_message,
      questions: assistant.questions,
      needs_validation: assistant.needs_validation,
      session: sessionPayload(nextRow),
      history: await loadHistory(sessionId),
    });
  } catch (error: any) {
    const message = error?.message ?? "Dialogue engine error";
    const status =
      message === "UNAUTHENTICATED"
        ? 401
        : message === "FORBIDDEN"
        ? 403
        : message === "Session not found"
        ? 404
        : 500;
    return json({ ok: false, error: message }, status);
  }
}
