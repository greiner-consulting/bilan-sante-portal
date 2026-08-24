import { NextResponse } from "next/server";
import {
  adminSupabase,
  createSupabaseServerClient,
} from "@/lib/supabaseServer";
import {
  AREA_INTAKE_PROMPTS,
  AREA_LABELS,
  dimensionForArea,
  generateDialogueQuestions,
  nextArea,
  type DialogueArea,
  type DialogueAreaMaterial,
  type DialogueQa,
  type DialogueQuestion,
} from "@/lib/diagnostic/dialogueV2LLM";
import { CONTEXT_SOURCE_HEADER } from "@/lib/diagnostic/conversationProtocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const V2_KEY = "dialogue_v2";

type V2Stage = "intake" | "questions" | "complete";

type V2State = {
  version: 2;
  area: DialogueArea;
  stage: V2Stage;
  materials: Record<DialogueArea, DialogueAreaMaterial>;
};

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

function emptyMaterial(): DialogueAreaMaterial {
  return { intake_answer: "", qa: [] };
}

function emptyState(): V2State {
  return {
    version: 2,
    area: "context",
    stage: "intake",
    materials: {
      context: emptyMaterial(),
      rh: emptyMaterial(),
      commercial: emptyMaterial(),
      pricing: emptyMaterial(),
      execution: emptyMaterial(),
    },
  };
}

function normalizeMaterial(raw: any): DialogueAreaMaterial {
  const qa: DialogueQa[] = Array.isArray(raw?.qa)
    ? raw.qa
        .map((item: any) => ({
          iteration: Math.min(Math.max(Number(item?.iteration ?? 1), 1), 3),
          question: item?.question as DialogueQuestion,
          answer: String(item?.answer ?? "").trim(),
        }))
        .filter((item: DialogueQa) => item.question?.question && item.answer)
    : [];

  return {
    intake_answer: String(raw?.intake_answer ?? "").trim(),
    qa,
  };
}

function normalizeState(coverage: unknown): V2State | null {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return null;
  const raw = (coverage as Record<string, any>)[V2_KEY];
  if (!raw || raw.version !== 2) return null;

  const area: DialogueArea = ["context", "rh", "commercial", "pricing", "execution"].includes(
    String(raw.area)
  )
    ? (raw.area as DialogueArea)
    : "context";

  const stage: V2Stage = ["intake", "questions", "complete"].includes(String(raw.stage))
    ? (raw.stage as V2Stage)
    : "intake";

  return {
    version: 2,
    area,
    stage,
    materials: {
      context: normalizeMaterial(raw.materials?.context),
      rh: normalizeMaterial(raw.materials?.rh),
      commercial: normalizeMaterial(raw.materials?.commercial),
      pricing: normalizeMaterial(raw.materials?.pricing),
      execution: normalizeMaterial(raw.materials?.execution),
    },
  };
}

function mergeCoverage(existing: unknown, state: V2State) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  return { ...base, [V2_KEY]: state };
}

async function loadOwnedSession(sessionId: string, userId: string) {
  const admin = adminSupabase();
  const { data, error } = await admin
    .from("diagnostic_sessions")
    .select(
      "id,user_id,status,phase,dimension,iteration,question_index,extracted_text,question_batch_json,coverage_json,updated_at,created_at"
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
    .limit(1000);

  if (error) return [];
  return data ?? [];
}

function currentState(row: any): V2State {
  return normalizeState(row?.coverage_json) ?? emptyState();
}

function uiPhase(state: V2State) {
  if (state.stage === "complete") return "report_ready";
  if (state.stage === "intake") return "area_intake";
  return "dimension_iteration";
}

function sessionPayload(row: any, state: V2State) {
  return {
    id: row.id,
    status: state.stage === "complete" ? "report_ready" : "in_progress",
    phase: uiPhase(state),
    area: state.area,
    area_label: AREA_LABELS[state.area],
    dimension: dimensionForArea(state.area),
    iteration: state.stage === "questions" ? Number(row.iteration ?? 1) : null,
    question_index: state.stage === "questions" ? Number(row.question_index ?? 0) : 0,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

async function saveState(params: {
  row: any;
  state: V2State;
  patch?: Record<string, unknown>;
}) {
  const admin = adminSupabase();
  const { error } = await admin
    .from("diagnostic_sessions")
    .update({
      coverage_json: mergeCoverage(params.row.coverage_json, params.state),
      updated_at: new Date().toISOString(),
      ...(params.patch ?? {}),
    })
    .eq("id", params.row.id);

  if (error) throw new Error(error.message);
}

async function insertEvent(params: {
  sessionId: string;
  userId: string;
  kind: string;
  payload: Record<string, unknown>;
}) {
  const admin = adminSupabase();
  const { error } = await admin.from("diagnostic_events").insert({
    session_id: params.sessionId,
    user_id: params.userId,
    kind: params.kind,
    payload: params.payload,
  });

  if (error) throw new Error(error.message);
}

async function startAreaQuestions(params: {
  row: any;
  state: V2State;
  userId: string;
  intakeAnswer: string;
}) {
  const area = params.state.area;
  params.state.materials[area].intake_answer = params.intakeAnswer;
  params.state.stage = "questions";

  await insertEvent({
    sessionId: params.row.id,
    userId: params.userId,
    kind: "CHAT_USER",
    payload: {
      phase: "area_intake",
      area,
      area_label: AREA_LABELS[area],
      message: params.intakeAnswer,
      theme: AREA_LABELS[area],
    },
  });

  const questions = await generateDialogueQuestions({
    area,
    iteration: 1,
    material: params.state.materials[area],
  });

  const extractedText =
    area === "context" && !params.row.extracted_text
      ? `${CONTEXT_SOURCE_HEADER}\n\n${params.intakeAnswer}`
      : params.row.extracted_text;

  await saveState({
    row: params.row,
    state: params.state,
    patch: {
      status: "in_progress",
      phase: "dimension_questions",
      dimension: dimensionForArea(area),
      iteration: 1,
      question_index: 0,
      question_batch_json: questions,
      ...(extractedText ? { extracted_text: extractedText } : {}),
    },
  });
}

async function answerCurrentQuestion(params: {
  row: any;
  state: V2State;
  userId: string;
  answer: string;
}) {
  const area = params.state.area;
  const iteration = Math.min(Math.max(Number(params.row.iteration ?? 1), 1), 3);
  const batch = Array.isArray(params.row.question_batch_json)
    ? (params.row.question_batch_json as DialogueQuestion[])
    : [];
  const index = Math.max(Number(params.row.question_index ?? 0), 0);
  const question = batch[index];

  if (!question?.question) {
    throw new Error("V2_ACTIVE_QUESTION_NOT_FOUND");
  }

  params.state.materials[area].qa.push({
    iteration,
    question,
    answer: params.answer,
  });

  await insertEvent({
    sessionId: params.row.id,
    userId: params.userId,
    kind: "QUESTION_ANSWER",
    payload: {
      engine: "dialogue_v2",
      area,
      area_label: AREA_LABELS[area],
      dimension: dimensionForArea(area),
      iteration,
      question_index: index,
      question,
      answer: params.answer,
      fact_id: question.fact_id,
    },
  });

  if (index + 1 < batch.length) {
    await saveState({
      row: params.row,
      state: params.state,
      patch: {
        question_index: index + 1,
      },
    });
    return;
  }

  if (iteration < 3) {
    const nextIteration = iteration + 1;
    const questions = await generateDialogueQuestions({
      area,
      iteration: nextIteration,
      material: params.state.materials[area],
    });

    await saveState({
      row: params.row,
      state: params.state,
      patch: {
        phase: "dimension_questions",
        iteration: nextIteration,
        question_index: 0,
        question_batch_json: questions,
      },
    });
    return;
  }

  const followingArea = nextArea(area);

  if (followingArea) {
    params.state.area = followingArea;
    params.state.stage = "intake";

    await saveState({
      row: params.row,
      state: params.state,
      patch: {
        status: "in_progress",
        phase: "dimension_questions",
        dimension: dimensionForArea(followingArea),
        iteration: null,
        question_index: 0,
        question_batch_json: [],
      },
    });
    return;
  }

  params.state.stage = "complete";
  await saveState({
    row: params.row,
    state: params.state,
    patch: {
      status: "report_ready",
      phase: "report_ready",
      dimension: 4,
      iteration: 3,
      question_index: 0,
      question_batch_json: [],
    },
  });
}

function assistantMessage(row: any, state: V2State) {
  if (state.stage === "complete") {
    return "L’entretien de diagnostic est terminé. La consolidation finale et l’édition du rapport seront traitées dans l’étape dédiée.";
  }

  if (state.stage === "intake") {
    return AREA_INTAKE_PROMPTS[state.area];
  }

  const batch = Array.isArray(row.question_batch_json)
    ? (row.question_batch_json as DialogueQuestion[])
    : [];
  const index = Math.max(Number(row.question_index ?? 0), 0);
  return batch[index]?.question ?? "Analyse de la réponse et préparation de la question suivante.";
}

function questionsPayload(row: any, state: V2State) {
  if (state.stage !== "questions") return [];
  return Array.isArray(row.question_batch_json) ? row.question_batch_json : [];
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await context.params;
    const userId = await getEffectiveUserId();
    let row = await loadOwnedSession(sessionId, userId);
    let state = currentState(row);

    if (!normalizeState(row.coverage_json)) {
      await saveState({
        row,
        state,
        patch: {
          status: "collected",
          question_index: 0,
          question_batch_json: [],
        },
      });
      row = await loadOwnedSession(sessionId, userId);
      state = currentState(row);
    }

    return json({
      ok: true,
      assistant_message: assistantMessage(row, state),
      questions: questionsPayload(row, state),
      needs_validation: false,
      session: sessionPayload(row, state),
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

    let row = await loadOwnedSession(sessionId, userId);
    let state = currentState(row);

    if (!normalizeState(row.coverage_json)) {
      state = emptyState();
    }

    if (state.stage === "intake") {
      await startAreaQuestions({ row, state, userId, intakeAnswer: message });
    } else if (state.stage === "questions") {
      await answerCurrentQuestion({ row, state, userId, answer: message });
    } else {
      return json({ ok: false, error: "DIAGNOSTIC_ALREADY_COMPLETE" }, 409);
    }

    row = await loadOwnedSession(sessionId, userId);
    state = currentState(row);

    return json({
      ok: true,
      assistant_message: assistantMessage(row, state),
      questions: questionsPayload(row, state),
      needs_validation: false,
      session: sessionPayload(row, state),
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
        : message === "DIAGNOSTIC_ALREADY_COMPLETE"
        ? 409
        : 500;
    return json({ ok: false, error: message }, status);
  }
}
