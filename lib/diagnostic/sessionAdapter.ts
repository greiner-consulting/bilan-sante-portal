import { adminSupabase } from "@/lib/supabaseServer";
import { runDiagnosticEngine } from "@/lib/diagnostic/diagnosticEngine";
import type { StructuredQuestion } from "@/lib/diagnostic/types";
import {
  normalizeQuestionBatch,
  normalizeDiagnosticResult,
} from "@/lib/diagnostic/diagnosticState";

type UiPhase =
  | "awaiting_trame"
  | "dimension_iteration"
  | "iteration_validation"
  | "final_objectives_validation"
  | "report_ready"
  | "completed";

type SessionRow = {
  id: string;
  user_id: string | null;
  status: string | null;
  phase: string | null;
  dimension: number | null;
  iteration: number | null;
  question_index: number | null;
  source_filename?: string | null;
  source_doc_path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  extracted_text?: string | null;
  question_batch_json?: unknown;
  diagnostic_result_json?: unknown;
  final_objectives_json?: unknown;
  consolidation_json?: unknown;
  coverage_json?: unknown;
  global_analysis_json?: unknown;
};

type PersistedTurn = {
  id: string;
  createdAt?: string;
  role: "assistant" | "user" | "question" | "system";
  text: string;
  kind?: string | null;
  phase?: string | null;
  dimensionId?: number | null;
  iteration?: number | null;
  questionId?: string | null;
  signalId?: string | null;
  theme?: string | null;
  ordinal?: number | null;
  total?: number | null;
};

type AssistantPayload = {
  assistant_message: string;
  questions: StructuredQuestion[];
  needs_validation: boolean;
  session: ReturnType<typeof mapSessionForUi>;
};

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: unknown): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function mapDiagnosticPhaseToUiPhase(
  phase?: string | null,
  status?: string | null,
  hasExtractedText?: boolean
): UiPhase {
  if (!hasExtractedText) return "awaiting_trame";

  if (phase === "dimension_questions") return "dimension_iteration";
  if (phase === "iteration_validation") return "iteration_validation";
  if (phase === "diagnostic_complete") return "report_ready";
  if (phase === "completed") return "completed";

  if (status === "completed") return "completed";
  if (status === "report_ready") return "report_ready";

  return "dimension_iteration";
}

function mapUiPhaseToStatus(phase: UiPhase, fallback?: string | null): string {
  if (phase === "awaiting_trame") return "collected";
  if (phase === "report_ready") return "report_ready";
  if (phase === "completed") return "completed";
  return fallback || "in_progress";
}

function normalizeQuestions(value: unknown): StructuredQuestion[] {
  return normalizeQuestionBatch(value).map((q) => ({
    fact_id: q.fact_id,
    theme: q.theme,
    constat: q.constat,
    risque_managerial: q.risque_managerial,
    question: q.question,
  }));
}

function isLegacyBilanSanteQuestion(question: StructuredQuestion): boolean {
  const text = normalizeForMatch(
    `${question.theme ?? ""} ${question.constat ?? ""} ${
      question.risque_managerial ?? ""
    } ${question.question ?? ""}`
  );

  const legacyMarkers = [
    "les equipes paraissent adaptees au niveau d activite actuel",
    "la repartition des roles semble fonctionner au quotidien",
    "la stabilite de fonctionnement peut etre fragilisee",
    "le fonctionnement autour de qualite et adequation des equipes tient aujourd hui",
    "le fonctionnement autour de ressources vs charge tient aujourd hui",
    "le fonctionnement autour de turnover absenteeisme stabilite tient aujourd hui",
    "le fonctionnement autour de clarte des roles tient aujourd hui",
    "quel est aujourd hui le point le moins maitrise",
    "comment cela se passe t il concretement aujourd hui",
    "sur qualite et adequation des equipes",
    "sur ressources vs charge",
    "sur turnover absenteeisme stabilite",
  ];

  return legacyMarkers.some((marker) => text.includes(marker));
}

function questionBatchLooksLegacy(questions: StructuredQuestion[]): boolean {
  if (questions.length === 0) return false;
  return questions.some(isLegacyBilanSanteQuestion);
}

function mapSessionForUi(row: SessionRow) {
  const uiPhase = mapDiagnosticPhaseToUiPhase(
    row.phase,
    row.status,
    Boolean(row.extracted_text)
  );

  return {
    id: row.id,
    user_id: row.user_id ?? undefined,
    status: mapUiPhaseToStatus(uiPhase, row.status),
    phase: uiPhase,
    dimension: row.dimension ?? undefined,
    iteration: row.iteration ?? undefined,
    question_index: Number(row.question_index ?? 0),
    source_filename: row.source_filename ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    trame_pdf_path: row.source_doc_path ?? null,
    has_trame_index: Boolean(row.extracted_text),
    has_extracted_text: Boolean(row.extracted_text),
  };
}

function buildAssistantMessageFromSession(row: SessionRow): string {
  if (!row.extracted_text) {
    return "Le diagnostic démarrera automatiquement dès qu’une trame exploitable sera disponible.";
  }

  const uiPhase = mapDiagnosticPhaseToUiPhase(row.phase, row.status, true);

  if (uiPhase === "dimension_iteration") {
    return "Le diagnostic est prêt. Répondez à la question affichée pour poursuivre l’exploration.";
  }

  if (uiPhase === "iteration_validation") {
    return "L’itération en cours est terminée. Merci de répondre par oui ou non pour valider la suite.";
  }

  if (uiPhase === "report_ready") {
    return "Le diagnostic conversationnel est terminé. Vous pouvez maintenant construire le rapport.";
  }

  if (uiPhase === "completed") {
    return "Le diagnostic est terminé.";
  }

  return "Le contexte de diagnostic est chargé.";
}

function mapDiagnosticResultToFrozenDimensions(row: SessionRow) {
  const result = normalizeDiagnosticResult(row.diagnostic_result_json);

  return result.dimensions.map((dimension) => ({
    dimensionId: dimension.dimension,
    score: Math.round((dimension.coverage_score || 0) / 20),
    consolidatedFindings: [
      dimension.constats_cles[0] || "Constat non consolidé.",
      dimension.constats_cles[1] || "Constat non consolidé.",
      dimension.constats_cles[2] || "Constat non consolidé.",
    ] as [string, string, string],
    dominantRootCause:
      dimension.cause_racine ||
      "La cause racine dominante reste à consolider.",
    unmanagedZones: (dimension.zones_non_pilotees || [])
      .slice(0, 6)
      .map((zone) => ({
        constat: zone,
        risqueManagerial:
          "Cette zone reste insuffisamment pilotée au regard du diagnostic.",
        consequence:
          "Le risque est de maintenir un angle mort dans la trajectoire de redressement.",
      })),
    frozenAt: row.updated_at ?? new Date().toISOString(),
    summary: dimension.cause_racine || undefined,
    evidenceSummary: [
      ...(dimension.validated_findings || []),
      ...(dimension.evidences || []),
    ].slice(0, 8),
  }));
}

function eventToTurn(
  event: {
    id?: string | number | null;
    kind?: string | null;
    payload?: any;
    created_at?: string | null;
  },
  index: number
): PersistedTurn[] {
  const kind = String(event.kind ?? "");
  const payload = event.payload ?? {};
  const id = String(event.id ?? `event-${index}`);
  const createdAt = event.created_at ?? undefined;

  if (kind === "CHAT_USER") {
    const text = normalizeText(payload.message);
    if (!text) return [];

    return [
      {
        id,
        createdAt,
        role: "user",
        text,
        kind,
        phase: payload.phase ?? null,
        dimensionId: payload.dimension ?? null,
        iteration: payload.iteration ?? null,
      },
    ];
  }

  if (kind === "CHAT_ASSISTANT") {
    const text = normalizeText(payload.assistant_message);
    if (!text) return [];

    return [
      {
        id,
        createdAt,
        role: "assistant",
        text,
        kind,
        phase: payload.phase ?? null,
        dimensionId: payload.dimension ?? null,
        iteration: payload.iteration ?? null,
      },
    ];
  }

  if (kind === "QUESTION_ANSWER") {
    const answer = normalizeText(payload.answer);
    const question = payload.question ?? {};
    const questionText = normalizeText(question.question);
    const factId = normalizeText(payload.fact_id ?? question.fact_id);
    const theme = normalizeText(question.theme);
    const questionId = `${factId || id}-${payload.question_index ?? index}`;

    const out: PersistedTurn[] = [];

    if (questionText) {
      out.push({
        id: `${id}-q`,
        createdAt,
        role: "question",
        text: questionText,
        kind,
        phase: "dimension_iteration",
        dimensionId: Number(payload.dimension ?? 0) || null,
        iteration: Number(payload.iteration ?? 0) || null,
        questionId,
        signalId: factId || null,
        theme: theme || null,
        ordinal:
          typeof payload.question_index !== "undefined"
            ? Number(payload.question_index) + 1
            : null,
        total: null,
      });
    }

    if (answer) {
      out.push({
        id: `${id}-a`,
        createdAt,
        role: "user",
        text: answer,
        kind,
        phase: "dimension_iteration",
        dimensionId: Number(payload.dimension ?? 0) || null,
        iteration: Number(payload.iteration ?? 0) || null,
        questionId,
        signalId: factId || null,
        theme: theme || null,
      });
    }

    return out;
  }

  return [];
}

async function loadSessionRow(sessionId: string): Promise<SessionRow> {
  const admin = adminSupabase();

  const { data, error } = await admin
    .from("diagnostic_sessions")
    .select(
      "id, user_id, status, phase, dimension, iteration, question_index, source_filename, source_doc_path, created_at, updated_at, extracted_text, question_batch_json, diagnostic_result_json, final_objectives_json, consolidation_json, coverage_json, global_analysis_json"
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Session not found");

  return data as SessionRow;
}

async function loadDiagnosticEvents(sessionId: string): Promise<PersistedTurn[]> {
  const admin = adminSupabase();

  const { data, error } = await admin
    .from("diagnostic_events")
    .select("id, kind, payload, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(800);

  if (error) return [];

  const turns: PersistedTurn[] = [];

  for (let i = 0; i < (data ?? []).length; i += 1) {
    const event = data?.[i];
    const eventTurns = eventToTurn(event as any, i);
    turns.push(...eventTurns);
  }

  return turns;
}

async function clearLegacyQuestionState(sessionId: string) {
  const admin = adminSupabase();

  await admin
    .from("diagnostic_sessions")
    .update({
      question_batch_json: [],
      question_index: 0,
      coverage_json: null,
      global_analysis_json: null,
      diagnostic_result_json: null,
      phase: "dimension_questions",
      status: "in_progress",
      dimension: 1,
      iteration: 1,
    })
    .eq("id", sessionId);
}

async function ensureDiagnosticBatch(params: {
  sessionId: string;
  userId: string;
  row: SessionRow;
}): Promise<SessionRow> {
  if (!params.row.extracted_text) return params.row;

  let session = mapSessionForUi(params.row);
  let questions = normalizeQuestions(params.row.question_batch_json);

  const mustGenerate =
    session.phase === "dimension_iteration" &&
    (questions.length === 0 || questionBatchLooksLegacy(questions));

  if (!mustGenerate) return params.row;

  if (questionBatchLooksLegacy(questions)) {
    await clearLegacyQuestionState(params.sessionId);
  }

  await runDiagnosticEngine(params.sessionId, params.userId, "");

  return loadSessionRow(params.sessionId);
}

export async function readDiagnosticSessionContext(params: {
  sessionId: string;
  userId: string;
}) {
  let row = await loadSessionRow(params.sessionId);
  row = await ensureDiagnosticBatch({
    sessionId: params.sessionId,
    userId: params.userId,
    row,
  });

  const session = mapSessionForUi(row);
  const questions = normalizeQuestions(row.question_batch_json);
  const history = await loadDiagnosticEvents(params.sessionId);

  return {
    ok: true,
    session,
    engine_state: {
      assistant_message: buildAssistantMessageFromSession(row),
      needs_validation: session.phase === "iteration_validation",
      question_batch_json:
        session.phase === "dimension_iteration" ? questions : [],
      final_objectives_json: row.final_objectives_json ?? null,
      consolidation_json: mapDiagnosticResultToFrozenDimensions(row),
      conversation_history_json: history,
      theme_coverage_json: [],
      bilan_state_json: {
        engine: "diagnostic",
        phase: row.phase,
        status: row.status,
        dimension: row.dimension,
        iteration: row.iteration,
        question_index: row.question_index,
        legacy_batch_rejected: questionBatchLooksLegacy(questions),
      },
    },
  };
}

export async function submitDiagnosticSessionMessage(params: {
  sessionId: string;
  userId: string;
  message: string;
}) {
  const assistant = await runDiagnosticEngine(
    params.sessionId,
    params.userId,
    params.message
  );

  const row = await loadSessionRow(params.sessionId);
  const session = mapSessionForUi(row);

  const payload: AssistantPayload = {
    assistant_message: assistant.assistant_message,
    questions: assistant.questions,
    needs_validation: assistant.needs_validation,
    session,
  };

  return {
    assistant: payload,
    assistant_message: payload.assistant_message,
    questions: payload.questions,
    needs_validation: payload.needs_validation,
    session,
  };
}

export async function bootstrapOrReadDiagnosticSession(params: {
  sessionId: string;
  userId: string;
}) {
  let row = await loadSessionRow(params.sessionId);

  if (!row.extracted_text) {
    const session = mapSessionForUi(row);

    return {
      assistant: {
        assistant_message:
          "Le diagnostic démarrera automatiquement dès qu’une trame exploitable sera disponible.",
        questions: [],
        needs_validation: false,
        session,
      },
      assistant_message:
        "Le diagnostic démarrera automatiquement dès qu’une trame exploitable sera disponible.",
      questions: [],
      needs_validation: false,
      session,
    };
  }

  row = await ensureDiagnosticBatch({
    sessionId: params.sessionId,
    userId: params.userId,
    row,
  });

  const questions = normalizeQuestions(row.question_batch_json);
  const session = mapSessionForUi(row);

  if (questions.length > 0 && !questionBatchLooksLegacy(questions)) {
    return {
      assistant: {
        assistant_message: buildAssistantMessageFromSession(row),
        questions: session.phase === "dimension_iteration" ? questions : [],
        needs_validation: session.phase === "iteration_validation",
        session,
      },
      assistant_message: buildAssistantMessageFromSession(row),
      questions: session.phase === "dimension_iteration" ? questions : [],
      needs_validation: session.phase === "iteration_validation",
      session,
    };
  }

  return submitDiagnosticSessionMessage({
    sessionId: params.sessionId,
    userId: params.userId,
    message: "",
  });
}