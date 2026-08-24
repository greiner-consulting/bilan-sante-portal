import { NextResponse } from "next/server";
import {
  adminSupabase,
  createSupabaseServerClient,
} from "@/lib/supabaseServer";
import {
  AREA_INTAKE_PROMPTS,
  AREA_LABELS,
  AREA_ORDER,
  analyzeDiagnosticState,
  buildDomainConclusion,
  dimensionForArea,
  formatDomainReview,
  formatIntermediateSynthesis,
  generateDiagnosticQuestions,
  nextArea,
  type CrossDomainMemory,
  type DiagnosticAnalysis,
  type DialogueArea,
  type DialogueAreaMaterial,
  type DialogueQa,
  type DialogueQuestion,
} from "@/lib/diagnostic/dialogueV3LLM";
import { CONTEXT_SOURCE_HEADER } from "@/lib/diagnostic/conversationProtocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const V3_KEY = "dialogue_v3";

type V3Stage = "intake" | "questions" | "review" | "complete";

type V3State = {
  version: 3;
  area: DialogueArea;
  stage: V3Stage;
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
  return {
    intake_answer: "",
    qa: [],
    analyses: {},
    syntheses: {},
    final_analysis: null,
    final_synthesis: "",
    swot: null,
    validation_feedback: [],
    validated: false,
  };
}

function emptyState(): V3State {
  return {
    version: 3,
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
    analyses:
      raw?.analyses && typeof raw.analyses === "object" && !Array.isArray(raw.analyses)
        ? raw.analyses
        : {},
    syntheses:
      raw?.syntheses && typeof raw.syntheses === "object" && !Array.isArray(raw.syntheses)
        ? raw.syntheses
        : {},
    final_analysis: raw?.final_analysis ?? null,
    final_synthesis: String(raw?.final_synthesis ?? "").trim(),
    swot: raw?.swot ?? null,
    validation_feedback: Array.isArray(raw?.validation_feedback)
      ? raw.validation_feedback.map(String).filter(Boolean).slice(-6)
      : [],
    validated: Boolean(raw?.validated),
  };
}

function normalizeState(coverage: unknown): V3State | null {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return null;
  const raw = (coverage as Record<string, any>)[V3_KEY];
  if (!raw || raw.version !== 3) return null;

  const area: DialogueArea = AREA_ORDER.includes(raw.area as DialogueArea)
    ? (raw.area as DialogueArea)
    : "context";
  const stage: V3Stage = ["intake", "questions", "review", "complete"].includes(
    String(raw.stage)
  )
    ? (raw.stage as V3Stage)
    : "intake";

  return {
    version: 3,
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

function mergeCoverage(existing: unknown, state: V3State) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  return { ...base, [V3_KEY]: state };
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
  if (!isBypass() && String(data.user_id ?? "") !== userId) throw new Error("FORBIDDEN");
  return data;
}

async function loadHistory(sessionId: string) {
  const admin = adminSupabase();
  const { data, error } = await admin
    .from("diagnostic_events")
    .select("id,kind,payload,created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(1500);
  if (error) return [];
  return data ?? [];
}

function currentState(row: any): V3State {
  return normalizeState(row?.coverage_json) ?? emptyState();
}

function crossDomainMemory(state: V3State): CrossDomainMemory[] {
  const currentIndex = AREA_ORDER.indexOf(state.area);
  return AREA_ORDER.slice(0, Math.max(currentIndex, 0))
    .map((area) => {
      const material = state.materials[area];
      if (!material?.validated || !material.final_synthesis) return null;
      return {
        area,
        label: AREA_LABELS[area],
        synthesis: material.final_synthesis,
        analysis: material.final_analysis ?? null,
      } as CrossDomainMemory;
    })
    .filter(Boolean) as CrossDomainMemory[];
}

function uiPhase(state: V3State) {
  if (state.stage === "complete") return "report_ready";
  if (state.stage === "intake") return "area_intake";
  if (state.stage === "review") return "domain_review";
  return "dimension_iteration";
}

function sessionPayload(row: any, state: V3State) {
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
  state: V3State;
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

async function insertAssistantMessage(params: {
  sessionId: string;
  userId: string;
  message: string;
  subtype: string;
  area: DialogueArea;
}) {
  await insertEvent({
    sessionId: params.sessionId,
    userId: params.userId,
    kind: "CHAT_ASSISTANT",
    payload: {
      engine: "dialogue_v3",
      subtype: params.subtype,
      area: params.area,
      area_label: AREA_LABELS[params.area],
      assistant_message: params.message,
    },
  });
}

async function startAreaQuestions(params: {
  row: any;
  state: V3State;
  userId: string;
  intakeAnswer: string;
}) {
  const area = params.state.area;
  const material = params.state.materials[area];
  material.intake_answer = params.intakeAnswer;
  params.state.stage = "questions";

  await insertEvent({
    sessionId: params.row.id,
    userId: params.userId,
    kind: "CHAT_USER",
    payload: {
      engine: "dialogue_v3",
      phase: "area_intake",
      area,
      area_label: AREA_LABELS[area],
      message: params.intakeAnswer,
      theme: AREA_LABELS[area],
    },
  });

  const analysis = await analyzeDiagnosticState({
    area,
    material,
    crossDomainMemory: crossDomainMemory(params.state),
    stage: "après recueil initial",
  });
  material.analyses.intake = analysis;

  const questions = await generateDiagnosticQuestions({
    area,
    iteration: 1,
    material,
    analysis,
    crossDomainMemory: crossDomainMemory(params.state),
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

async function finalizeIteration(params: {
  row: any;
  state: V3State;
  userId: string;
  iteration: number;
}) {
  const area = params.state.area;
  const material = params.state.materials[area];
  const analysis = await analyzeDiagnosticState({
    area,
    material,
    crossDomainMemory: crossDomainMemory(params.state),
    stage: `après itération ${params.iteration}/3`,
  });
  material.analyses[`iteration_${params.iteration}`] = analysis;

  if (params.iteration < 3) {
    const synthesis = formatIntermediateSynthesis({
      area,
      iteration: params.iteration,
      analysis,
    });
    material.syntheses[`iteration_${params.iteration}`] = synthesis;

    await insertAssistantMessage({
      sessionId: params.row.id,
      userId: params.userId,
      message: synthesis,
      subtype: "intermediate_synthesis",
      area,
    });

    const nextIteration = params.iteration + 1;
    const questions = await generateDiagnosticQuestions({
      area,
      iteration: nextIteration,
      material,
      analysis,
      crossDomainMemory: crossDomainMemory(params.state),
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

  material.final_analysis = analysis;
  const conclusion = await buildDomainConclusion({
    area,
    material,
    analysis,
    crossDomainMemory: crossDomainMemory(params.state),
  });
  material.final_synthesis = conclusion.synthesis;
  material.swot = conclusion.swot;
  params.state.stage = "review";

  const reviewMessage = formatDomainReview({
    area,
    synthesis: conclusion.synthesis,
    swot: conclusion.swot,
  });

  await insertAssistantMessage({
    sessionId: params.row.id,
    userId: params.userId,
    message: reviewMessage,
    subtype: "domain_review",
    area,
  });

  await saveState({
    row: params.row,
    state: params.state,
    patch: {
      phase: "dimension_questions",
      iteration: 3,
      question_index: 0,
      question_batch_json: [],
    },
  });
}

async function answerCurrentQuestion(params: {
  row: any;
  state: V3State;
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
  if (!question?.question) throw new Error("V3_ACTIVE_QUESTION_NOT_FOUND");

  params.state.materials[area].qa.push({ iteration, question, answer: params.answer });

  await insertEvent({
    sessionId: params.row.id,
    userId: params.userId,
    kind: "QUESTION_ANSWER",
    payload: {
      engine: "dialogue_v3",
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
      patch: { question_index: index + 1 },
    });
    return;
  }

  await finalizeIteration({
    row: params.row,
    state: params.state,
    userId: params.userId,
    iteration,
  });
}

function isAffirmative(message: string) {
  const x = message.trim().toLowerCase();
  return /^(oui|ok|d'accord|d’accord|validé|valide|c'est juste|c’est juste|exact|exactement)[.! ]*$/.test(x);
}

async function handleReview(params: {
  row: any;
  state: V3State;
  userId: string;
  message: string;
}) {
  const area = params.state.area;
  const material = params.state.materials[area];

  await insertEvent({
    sessionId: params.row.id,
    userId: params.userId,
    kind: "CHAT_USER",
    payload: {
      engine: "dialogue_v3",
      phase: "domain_review",
      area,
      area_label: AREA_LABELS[area],
      message: params.message,
    },
  });

  if (!isAffirmative(params.message)) {
    material.validation_feedback = [
      ...(material.validation_feedback || []),
      params.message,
    ].slice(-6);

    const revisedAnalysis = await analyzeDiagnosticState({
      area,
      material,
      crossDomainMemory: crossDomainMemory(params.state),
      stage: "révision après correction du dirigeant",
    });
    material.final_analysis = revisedAnalysis;

    const revised = await buildDomainConclusion({
      area,
      material,
      analysis: revisedAnalysis,
      crossDomainMemory: crossDomainMemory(params.state),
    });
    material.final_synthesis = revised.synthesis;
    material.swot = revised.swot;

    const reviewMessage = formatDomainReview({
      area,
      synthesis: revised.synthesis,
      swot: revised.swot,
    });

    await insertAssistantMessage({
      sessionId: params.row.id,
      userId: params.userId,
      message: reviewMessage,
      subtype: "domain_review_revised",
      area,
    });

    await saveState({ row: params.row, state: params.state });
    return;
  }

  material.validated = true;
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

function assistantMessage(row: any, state: V3State) {
  if (state.stage === "complete") {
    return "L’entretien de diagnostic est terminé. Les cinq domaines ont été analysés et validés. La consolidation finale et l’édition du rapport seront traitées dans l’étape dédiée.";
  }
  if (state.stage === "intake") return AREA_INTAKE_PROMPTS[state.area];
  if (state.stage === "review") {
    const material = state.materials[state.area];
    if (material.final_synthesis && material.swot) {
      return formatDomainReview({
        area: state.area,
        synthesis: material.final_synthesis,
        swot: material.swot,
      });
    }
    return "Validez ou corrigez le bilan du domaine.";
  }

  const batch = Array.isArray(row.question_batch_json)
    ? (row.question_batch_json as DialogueQuestion[])
    : [];
  const index = Math.max(Number(row.question_index ?? 0), 0);
  return batch[index]?.question ?? "Analyse de la réponse et préparation de la question suivante.";
}

function questionsPayload(row: any, state: V3State) {
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
      state = emptyState();
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
      needs_validation: state.stage === "review",
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
    if (!normalizeState(row.coverage_json)) state = emptyState();

    if (state.stage === "intake") {
      await startAreaQuestions({ row, state, userId, intakeAnswer: message });
    } else if (state.stage === "questions") {
      await answerCurrentQuestion({ row, state, userId, answer: message });
    } else if (state.stage === "review") {
      await handleReview({ row, state, userId, message });
    } else {
      return json({ ok: false, error: "DIAGNOSTIC_ALREADY_COMPLETE" }, 409);
    }

    row = await loadOwnedSession(sessionId, userId);
    state = currentState(row);

    return json({
      ok: true,
      assistant_message: assistantMessage(row, state),
      questions: questionsPayload(row, state),
      needs_validation: state.stage === "review",
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
