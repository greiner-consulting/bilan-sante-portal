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

type FinalObjective = {
  id: string;
  dimensionId: string | number;
  objectiveLabel: string;
  owner: string;
  keyIndicator: string;
  dueDate: string;
  potentialGain: string;
  gainHypotheses: string[];
  validationStatus: "proposed" | "validated" | "adjusted" | "refused";
  quickWin: string;
};

type FinalObjectiveSet = {
  header: string;
  objectives: FinalObjective[];
  decisionsCapturedAt?: string;
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

function normalizeForSearch(value: unknown): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function textIncludesAny(text: string, words: string[]) {
  const normalized = normalizeForSearch(text);

  return words.some((word) => normalized.includes(normalizeForSearch(word)));
}

function mapDiagnosticPhaseToUiPhase(
  phase?: string | null,
  status?: string | null,
  hasExtractedText?: boolean
): UiPhase {
  if (!hasExtractedText) return "awaiting_trame";

  if (phase === "dimension_questions") return "dimension_iteration";
  if (phase === "iteration_validation") return "iteration_validation";
  if (phase === "final_objectives_validation") {
    return "final_objectives_validation";
  }
  if (phase === "report_ready") return "report_ready";
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

function normalizeFinalObjectives(raw: unknown): FinalObjectiveSet | null {
  if (!raw || typeof raw !== "object") return null;

  const source = raw as any;
  const values = Array.isArray(source.objectives)
    ? source.objectives
    : Array.isArray(raw)
    ? raw
    : [];

  const objectives: FinalObjective[] = values
    .map((o: any, index: number): FinalObjective => {
      const dimensionId = o?.dimensionId ?? o?.dimension ?? "";

      const validationStatus =
        o?.validationStatus === "validated" ||
        o?.validationStatus === "adjusted" ||
        o?.validationStatus === "refused" ||
        o?.validationStatus === "proposed"
          ? o.validationStatus
          : "proposed";

      return {
        id: String(o?.id ?? `obj-${index + 1}`),
        dimensionId,
        objectiveLabel: String(
          o?.objectiveLabel ?? o?.objectif ?? o?.label ?? ""
        ).trim(),
        owner: String(o?.owner ?? o?.responsable ?? "").trim(),
        keyIndicator: String(o?.keyIndicator ?? o?.indicateur ?? "").trim(),
        dueDate: String(o?.dueDate ?? o?.echeance ?? "").trim(),
        potentialGain: String(
          o?.potentialGain ?? o?.gain_potentiel ?? ""
        ).trim(),
        gainHypotheses: Array.isArray(o?.gainHypotheses)
          ? o.gainHypotheses.map(String).filter(Boolean)
          : Array.isArray(o?.hypotheses)
          ? o.hypotheses.map(String).filter(Boolean)
          : String(o?.hypotheses ?? "").trim()
          ? [String(o.hypotheses).trim()]
          : [],
        validationStatus,
        quickWin: String(o?.quickWin ?? o?.quick_win ?? "").trim(),
      };
    })
    .filter((o: FinalObjective) =>
      Boolean(o.objectiveLabel || o.keyIndicator || o.potentialGain)
    );

  if (objectives.length === 0) {
    return {
      header:
        String(source.header ?? "").trim() ||
        "Objectifs finaux non encore renseignés.",
      objectives: [],
      decisionsCapturedAt:
        typeof source.decisionsCapturedAt === "string"
          ? source.decisionsCapturedAt
          : undefined,
    };
  }

  return {
    header:
      String(source.header ?? "").trim() ||
      "Objectifs finaux proposés à partir des dimensions consolidées.",
    objectives,
    decisionsCapturedAt:
      typeof source.decisionsCapturedAt === "string"
        ? source.decisionsCapturedAt
        : undefined,
  };
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

  if (uiPhase === "final_objectives_validation") {
    return "Les objectifs finaux sont proposés. Merci de les valider ou d’indiquer les ajustements souhaités.";
  }

  if (uiPhase === "report_ready") {
    return "Le diagnostic conversationnel est terminé. Vous pouvez maintenant construire le rapport.";
  }

  if (uiPhase === "completed") {
    return "Le diagnostic est terminé.";
  }

  return "Le contexte de diagnostic est chargé.";
}

function buildZoneContext(params: {
  zone: string;
  dimension: {
    cause_racine?: string;
    constats_cles?: string[];
    validated_findings?: string[];
    evidences?: string[];
    signals?: string[];
  };
}) {
  const { zone, dimension } = params;

  return [
    zone,
    dimension.cause_racine,
    ...(dimension.constats_cles || []),
    ...(dimension.validated_findings || []),
    ...(dimension.evidences || []),
    ...(dimension.signals || []),
  ]
    .filter(Boolean)
    .join(" ");
}

function inferZoneManagerialRisk(params: {
  zone: string;
  dimension: any;
}) {
  const { zone, dimension } = params;
  const context = buildZoneContext({ zone, dimension });

  if (
    textIncludesAny(context, [
      "florian",
      "dominique",
      "encadrement",
      "responsable",
      "chef d agence",
      "supervision",
      "delegation",
      "responsabilite",
      "rattachement",
      "manager",
      "roles",
      "role",
      "hiérarchique",
      "hierarchique",
    ])
  ) {
    return "Le risque managérial porte sur une responsabilité insuffisamment sécurisée : les arbitrages, la supervision et le suivi opérationnel peuvent dépendre de personnes clés sans cadre de délégation suffisamment explicite.";
  }

  if (
    textIncludesAny(context, [
      "qhse",
      "qualite",
      "qualité",
      "hygiene",
      "hygiène",
      "securite",
      "sécurité",
      "environnement",
      "hors site",
      "distance",
      "regional",
      "régional",
    ])
  ) {
    return "Le risque managérial porte sur une maîtrise locale incomplète : une fonction support trop distante peut réduire la réactivité, affaiblir le contrôle terrain et créer des angles morts dans le suivi quotidien.";
  }

  if (
    textIncludesAny(context, [
      "marge",
      "rentabilite",
      "rentabilité",
      "ebitda",
      "cout",
      "coût",
      "taux horaire",
      "main d oeuvre",
      "main-d oeuvre",
      "imputation",
      "affaire",
      "affaires",
    ])
  ) {
    return "Le risque managérial porte sur une lecture économique insuffisamment fiable : les décisions peuvent être prises sur des marges, coûts ou imputations incomplets, avec un risque d’arbitrage commercial ou opérationnel mal fondé.";
  }

  if (
    textIncludesAny(context, [
      "planning",
      "charge",
      "capacite",
      "capacité",
      "ressources",
      "heures",
      "productivite",
      "productivité",
      "chantier",
      "chantiers",
    ])
  ) {
    return "Le risque managérial porte sur un pilotage charge-capacité insuffisamment maîtrisé : les ajustements de ressources peuvent rester réactifs, dépendants des personnes, et déconnectés d’une vision consolidée des besoins.";
  }

  if (
    textIncludesAny(context, [
      "commercial",
      "pipeline",
      "client",
      "clients",
      "devis",
      "go no go",
      "offre",
      "offres",
      "conversion",
      "prix",
      "marché",
      "marche",
    ])
  ) {
    return "Le risque managérial porte sur une discipline commerciale incomplète : les priorités, arbitrages de prix et décisions de poursuite peuvent manquer de formalisation ou de traçabilité économique.";
  }

  return "Le risque managérial porte sur une zone de pilotage encore insuffisamment sécurisée : les responsabilités, les indicateurs et les arbitrages doivent être clarifiés pour réduire la dépendance aux pratiques individuelles.";
}

function inferZoneConsequence(params: {
  zone: string;
  dimension: any;
}) {
  const { zone, dimension } = params;
  const context = buildZoneContext({ zone, dimension });

  if (
    textIncludesAny(context, [
      "florian",
      "dominique",
      "encadrement",
      "responsable",
      "chef d agence",
      "supervision",
      "delegation",
      "responsabilite",
      "rattachement",
      "manager",
      "roles",
      "role",
      "hiérarchique",
      "hierarchique",
    ])
  ) {
    return "La conséquence possible est une fragilité d’exécution : décisions ralenties, arbitrages implicites, surcharge du chef d’agence ou perte de continuité en cas d’absence ou de montée en charge.";
  }

  if (
    textIncludesAny(context, [
      "qhse",
      "qualite",
      "qualité",
      "hygiene",
      "hygiène",
      "securite",
      "sécurité",
      "environnement",
      "hors site",
      "distance",
      "regional",
      "régional",
    ])
  ) {
    return "La conséquence possible est une moindre maîtrise terrain : délais de traitement, défaut de prévention, non-conformités détectées tardivement ou difficulté à intégrer les exigences QHSE dans les routines locales.";
  }

  if (
    textIncludesAny(context, [
      "marge",
      "rentabilite",
      "rentabilité",
      "ebitda",
      "cout",
      "coût",
      "taux horaire",
      "main d oeuvre",
      "main-d oeuvre",
      "imputation",
      "affaire",
      "affaires",
    ])
  ) {
    return "La conséquence possible est une dégradation de la performance économique : marge réelle mal anticipée, écarts détectés trop tard, plans d’action retardés et risque de perte non objectivée affaire par affaire.";
  }

  if (
    textIncludesAny(context, [
      "planning",
      "charge",
      "capacite",
      "capacité",
      "ressources",
      "heures",
      "productivite",
      "productivité",
      "chantier",
      "chantiers",
    ])
  ) {
    return "La conséquence possible est une perte de productivité : sous-charge ou surcharge non anticipée, arbitrages tardifs, dérive des heures et difficulté à sécuriser les engagements de production.";
  }

  if (
    textIncludesAny(context, [
      "commercial",
      "pipeline",
      "client",
      "clients",
      "devis",
      "go no go",
      "offre",
      "offres",
      "conversion",
      "prix",
      "marché",
      "marche",
    ])
  ) {
    return "La conséquence possible est une fragilisation du développement commercial : priorités dispersées, opportunités mal qualifiées, décisions de prix insuffisamment sécurisées et prévision de chiffre d’affaires moins fiable.";
  }

  return "La conséquence possible est le maintien d’un angle mort dans le pilotage : les écarts peuvent être détectés trop tard et les actions correctives manquer de responsable, de calendrier ou d’indicateur.";
}

function mapDiagnosticResultToFrozenDimensions(row: SessionRow) {
  const result = normalizeDiagnosticResult(row.diagnostic_result_json);

  return result.dimensions.map((dimension) => ({
    dimensionId: dimension.dimension,
    score: Math.max(
      0,
      Math.min(5, Math.round((dimension.coverage_score || 0) / 20))
    ),
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
        risqueManagerial: inferZoneManagerialRisk({ zone, dimension }),
        consequence: inferZoneConsequence({ zone, dimension }),
      })),
    frozenAt: row.updated_at ?? new Date().toISOString(),
    summary: dimension.cause_racine || undefined,
    evidenceSummary: [
      ...(dimension.validated_findings || []),
      ...(dimension.evidences || []),
    ].slice(0, 8),
  }));
}

function eventToTurns(
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
    const questionIndex =
      typeof payload.question_index !== "undefined"
        ? Number(payload.question_index)
        : index;

    const questionId = `${factId || id}-${questionIndex}`;
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
        ordinal: Number.isFinite(questionIndex) ? questionIndex + 1 : null,
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
    turns.push(...eventToTurns(event as any, i));
  }

  return turns;
}

export async function readDiagnosticSessionContext(params: {
  sessionId: string;
  userId: string;
}) {
  const row = await loadSessionRow(params.sessionId);
  const session = mapSessionForUi(row);
  const questions = normalizeQuestions(row.question_batch_json);
  const history = await loadDiagnosticEvents(params.sessionId);
  const finalObjectives = normalizeFinalObjectives(row.final_objectives_json);

  return {
    ok: true,
    session,
    engine_state: {
      assistant_message: buildAssistantMessageFromSession(row),
      needs_validation:
        session.phase === "iteration_validation" ||
        session.phase === "final_objectives_validation",
      question_batch_json:
        session.phase === "dimension_iteration" ? questions : [],
      final_objectives_json: finalObjectives,
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
  const row = await loadSessionRow(params.sessionId);

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

  const questions = normalizeQuestions(row.question_batch_json);
  const session = mapSessionForUi(row);

  if (
    questions.length > 0 ||
    session.phase === "iteration_validation" ||
    session.phase === "final_objectives_validation" ||
    session.phase === "report_ready" ||
    session.phase === "completed"
  ) {
    return {
      assistant: {
        assistant_message: buildAssistantMessageFromSession(row),
        questions: session.phase === "dimension_iteration" ? questions : [],
        needs_validation:
          session.phase === "iteration_validation" ||
          session.phase === "final_objectives_validation",
        session,
      },
      assistant_message: buildAssistantMessageFromSession(row),
      questions: session.phase === "dimension_iteration" ? questions : [],
      needs_validation:
        session.phase === "iteration_validation" ||
        session.phase === "final_objectives_validation",
      session,
    };
  }

  return submitDiagnosticSessionMessage({
    sessionId: params.sessionId,
    userId: params.userId,
    message: "",
  });
}