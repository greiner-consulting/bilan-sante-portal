import { NextResponse } from "next/server";
import {
  adminSupabase,
  createSupabaseServerClient,
} from "@/lib/supabaseServer";
import {
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
import {
  AREA_NARRATIVE_PROMPTS,
  STRUCTURED_INTAKE_SCHEMAS,
  emptyStructuredData,
  sanitizeStructuredData,
  type StructuredIntakeData,
  type StructuredIntakeSchema,
} from "@/lib/diagnostic/structuredIntake";
import { CONTEXT_SOURCE_HEADER } from "@/lib/diagnostic/conversationProtocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const V4_KEY = "dialogue_v4";

type V4Stage =
  | "structured_intake"
  | "narrative_intake"
  | "questions"
  | "review"
  | "complete";

type V4AreaMaterial = {
  structured_data: StructuredIntakeData | null;
  narrative_answer: string;
  qa: DialogueQa[];
  analyses: Record<string, DiagnosticAnalysis>;
  syntheses: Record<string, string>;
  final_analysis?: DiagnosticAnalysis | null;
  final_synthesis?: string;
  swot?: any;
  validation_feedback?: string[];
  validated?: boolean;
};

type V4State = {
  version: 4;
  area: DialogueArea;
  stage: V4Stage;
  materials: Record<DialogueArea, V4AreaMaterial>;
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

function schemaForArea(area: DialogueArea): StructuredIntakeSchema {
  const schema = STRUCTURED_INTAKE_SCHEMAS[area];
  if (!schema) throw new Error(`STRUCTURED_SCHEMA_NOT_FOUND:${area}`);
  return schema;
}

function emptyMaterial(area: DialogueArea): V4AreaMaterial {
  return {
    structured_data: emptyStructuredData(schemaForArea(area)),
    narrative_answer: "",
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

function emptyState(): V4State {
  return {
    version: 4,
    area: "context",
    stage: "structured_intake",
    materials: {
      context: emptyMaterial("context"),
      rh: emptyMaterial("rh"),
      commercial: emptyMaterial("commercial"),
      pricing: emptyMaterial("pricing"),
      execution: emptyMaterial("execution"),
    },
  };
}

function normalizeAreaMaterial(area: DialogueArea, raw: any): V4AreaMaterial {
  const schema = schemaForArea(area);
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
    structured_data: sanitizeStructuredData(
      schema,
      raw?.structured_data ?? emptyStructuredData(schema)
    ),
    narrative_answer: String(raw?.narrative_answer ?? "").trim(),
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

function normalizeState(coverage: unknown): V4State | null {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return null;
  const raw = (coverage as Record<string, any>)[V4_KEY];
  if (!raw || raw.version !== 4) return null;

  const area: DialogueArea = AREA_ORDER.includes(raw.area as DialogueArea)
    ? (raw.area as DialogueArea)
    : "context";
  const stage: V4Stage = [
    "structured_intake",
    "narrative_intake",
    "questions",
    "review",
    "complete",
  ].includes(String(raw.stage))
    ? (raw.stage as V4Stage)
    : "structured_intake";

  return {
    version: 4,
    area,
    stage,
    materials: {
      context: normalizeAreaMaterial("context", raw.materials?.context),
      rh: normalizeAreaMaterial("rh", raw.materials?.rh),
      commercial: normalizeAreaMaterial("commercial", raw.materials?.commercial),
      pricing: normalizeAreaMaterial("pricing", raw.materials?.pricing),
      execution: normalizeAreaMaterial("execution", raw.materials?.execution),
    },
  };
}

function mergeCoverage(existing: unknown, state: V4State) {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  return { ...base, [V4_KEY]: state };
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
    .limit(2000);
  if (error) return [];
  return data ?? [];
}

function currentState(row: any): V4State {
  return normalizeState(row?.coverage_json) ?? emptyState();
}

function crossDomainMemory(state: V4State): CrossDomainMemory[] {
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

function structuredAsText(area: DialogueArea, data: StructuredIntakeData) {
  const schema = schemaForArea(area);
  const parts: string[] = [
    `DONNÉES STRUCTURÉES — ${schema.title}`,
    "Les cellules vides signifient : donnée non disponible / non renseignée. Une cellule vide ne signifie jamais zéro.",
  ];

  for (const table of schema.tables) {
    parts.push("", table.title);
    const rows = data.tables[table.key] || [];
    rows.forEach((row, index) => {
      const cells = table.columns
        .map((column) => {
          const value = String(row?.[column.key] ?? "").trim();
          if (!value) return null;
          return `${column.label}${column.unit ? ` (${column.unit})` : ""}: ${value}`;
        })
        .filter(Boolean);
      if (cells.length) parts.push(`Ligne ${index + 1} — ${cells.join(" | ")}`);
    });
  }

  const fieldLines = (schema.fields || [])
    .map((field) => {
      const value = String(data.fields?.[field.key] ?? "").trim();
      if (!value) return null;
      return `${field.label}${field.unit ? ` (${field.unit})` : ""}: ${value}`;
    })
    .filter(Boolean);

  if (fieldLines.length) parts.push("", "Indicateurs complémentaires", ...fieldLines);
  return parts.join("\n");
}

function toDialogueMaterial(area: DialogueArea, material: V4AreaMaterial): DialogueAreaMaterial {
  const structured = material.structured_data
    ? structuredAsText(area, material.structured_data)
    : "Aucune donnée structurée transmise.";

  return {
    intake_answer: `${structured}\n\nRÉCIT DU DIRIGEANT\n${material.narrative_answer || "Aucun récit transmis."}`,
    qa: material.qa,
    analyses: material.analyses,
    syntheses: material.syntheses,
    final_analysis: material.final_analysis ?? null,
    final_synthesis: material.final_synthesis ?? "",
    swot: material.swot ?? null,
    validation_feedback: material.validation_feedback || [],
    validated: Boolean(material.validated),
  };
}

function hasMeaningfulStructuredInput(schema: StructuredIntakeSchema, data: StructuredIntakeData) {
  for (const field of schema.fields || []) {
    if (String(data.fields?.[field.key] ?? "").trim()) return true;
  }

  for (const table of schema.tables) {
    const rows = data.tables?.[table.key] || [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      const defaultRow = table.rows[i] || {};
      for (const column of table.columns) {
        const value = String(row[column.key] ?? "").trim();
        const defaultValue = String(defaultRow[column.key] ?? "").trim();
        if (value && value !== defaultValue) return true;
        if (column.kind === "number" && value) return true;
      }
    }
  }
  return false;
}

function uiPhase(state: V4State) {
  if (state.stage === "complete") return "report_ready";
  if (state.stage === "structured_intake") return "structured_intake";
  if (state.stage === "narrative_intake") return "area_intake";
  if (state.stage === "review") return "domain_review";
  return "dimension_iteration";
}

function sessionPayload(row: any, state: V4State) {
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
  state: V4State;
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
      engine: "dialogue_v4",
      subtype: params.subtype,
      area: params.area,
      area_label: AREA_LABELS[params.area],
      assistant_message: params.message,
    },
  });
}

async function handleStructuredIntake(params: {
  row: any;
  state: V4State;
  userId: string;
  rawData: unknown;
}) {
  const area = params.state.area;
  const schema = schemaForArea(area);
  const data = sanitizeStructuredData(schema, params.rawData);
  if (!hasMeaningfulStructuredInput(schema, data)) {
    throw new Error("STRUCTURED_INTAKE_EMPTY");
  }

  params.state.materials[area].structured_data = data;
  params.state.stage = "narrative_intake";

  await insertEvent({
    sessionId: params.row.id,
    userId: params.userId,
    kind: "STRUCTURED_INTAKE",
    payload: {
      engine: "dialogue_v4",
      area,
      area_label: AREA_LABELS[area],
      schema_title: schema.title,
      structured_data: data,
      display_text: structuredAsText(area, data),
    },
  });

  await saveState({
    row: params.row,
    state: params.state,
    patch: {
      status: "in_progress",
      phase: "dimension_questions",
      dimension: dimensionForArea(area),
      iteration: null,
      question_index: 0,
      question_batch_json: [],
    },
  });
}

async function startAreaQuestions(params: {
  row: any;
  state: V4State;
  userId: string;
  narrativeAnswer: string;
}) {
  const area = params.state.area;
  const material = params.state.materials[area];
  material.narrative_answer = params.narrativeAnswer;
  params.state.stage = "questions";

  await insertEvent({
    sessionId: params.row.id,
    userId: params.userId,
    kind: "CHAT_USER",
    payload: {
      engine: "dialogue_v4",
      phase: "area_intake",
      area,
      area_label: AREA_LABELS[area],
      message: params.narrativeAnswer,
      theme: AREA_LABELS[area],
    },
  });

  const llmMaterial = toDialogueMaterial(area, material);
  const analysis = await analyzeDiagnosticState({
    area,
    material: llmMaterial,
    crossDomainMemory: crossDomainMemory(params.state),
    stage: "après données structurées et récit du dirigeant",
  });
  material.analyses.intake = analysis;

  const questions = await generateDiagnosticQuestions({
    area,
    iteration: 1,
    material: toDialogueMaterial(area, material),
    analysis,
    crossDomainMemory: crossDomainMemory(params.state),
  });

  const extractedText =
    area === "context" && !params.row.extracted_text
      ? `${CONTEXT_SOURCE_HEADER}\n\n${structuredAsText(area, material.structured_data!)}\n\nRÉCIT DU DIRIGEANT\n${params.narrativeAnswer}`
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
  state: V4State;
  userId: string;
  iteration: number;
}) {
  const area = params.state.area;
  const material = params.state.materials[area];
  const analysis = await analyzeDiagnosticState({
    area,
    material: toDialogueMaterial(area, material),
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
      material: toDialogueMaterial(area, material),
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
    material: toDialogueMaterial(area, material),
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
  state: V4State;
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
  if (!question?.question) throw new Error("V4_ACTIVE_QUESTION_NOT_FOUND");

  params.state.materials[area].qa.push({ iteration, question, answer: params.answer });

  await insertEvent({
    sessionId: params.row.id,
    userId: params.userId,
    kind: "QUESTION_ANSWER",
    payload: {
      engine: "dialogue_v4",
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
  return /^(oui|ok|d'accord|d’accord|validé|valide|c'est juste|c’est juste|exact|exactement)[.! ]*$/.test(
    x
  );
}

async function handleReview(params: {
  row: any;
  state: V4State;
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
      engine: "dialogue_v4",
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
      material: toDialogueMaterial(area, material),
      crossDomainMemory: crossDomainMemory(params.state),
      stage: "révision après correction du dirigeant",
    });
    material.final_analysis = revisedAnalysis;

    const revised = await buildDomainConclusion({
      area,
      material: toDialogueMaterial(area, material),
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
    params.state.stage = "structured_intake";
    params.state.materials[followingArea] = emptyMaterial(followingArea);
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

function assistantMessage(row: any, state: V4State) {
  if (state.stage === "complete") {
    return "L’entretien de diagnostic est terminé. Les cinq domaines ont été analysés et validés. La consolidation finale et l’édition du rapport seront traitées dans l’étape dédiée.";
  }
  if (state.stage === "structured_intake") {
    return schemaForArea(state.area).instructions;
  }
  if (state.stage === "narrative_intake") {
    return AREA_NARRATIVE_PROMPTS[state.area];
  }
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

function questionsPayload(row: any, state: V4State) {
  if (state.stage !== "questions") return [];
  return Array.isArray(row.question_batch_json) ? row.question_batch_json : [];
}

function responsePayload(row: any, state: V4State, history: any[]) {
  const schema = state.stage === "structured_intake" ? schemaForArea(state.area) : null;
  return {
    ok: true,
    assistant_message: assistantMessage(row, state),
    questions: questionsPayload(row, state),
    needs_validation: state.stage === "review",
    intake_schema: schema,
    intake_data:
      state.stage === "structured_intake"
        ? state.materials[state.area].structured_data ?? emptyStructuredData(schema!)
        : null,
    session: sessionPayload(row, state),
    history,
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

    return json(responsePayload(row, state, await loadHistory(sessionId)));
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

    let row = await loadOwnedSession(sessionId, userId);
    let state = currentState(row);
    if (!normalizeState(row.coverage_json)) state = emptyState();

    if (state.stage === "structured_intake") {
      await handleStructuredIntake({
        row,
        state,
        userId,
        rawData: body?.structured_data,
      });
    } else {
      const message = String(body?.message ?? "").trim();
      if (!message) return json({ ok: false, error: "Message vide" }, 400);

      if (state.stage === "narrative_intake") {
        await startAreaQuestions({ row, state, userId, narrativeAnswer: message });
      } else if (state.stage === "questions") {
        await answerCurrentQuestion({ row, state, userId, answer: message });
      } else if (state.stage === "review") {
        await handleReview({ row, state, userId, message });
      } else {
        return json({ ok: false, error: "DIAGNOSTIC_ALREADY_COMPLETE" }, 409);
      }
    }

    row = await loadOwnedSession(sessionId, userId);
    state = currentState(row);

    return json(responsePayload(row, state, await loadHistory(sessionId)));
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
        : message === "STRUCTURED_INTAKE_EMPTY"
        ? 400
        : 500;
    return json({ ok: false, error: message }, status);
  }
}
