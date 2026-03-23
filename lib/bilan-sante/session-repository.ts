import { adminSupabase } from "@/lib/supabaseServer";
import type {
  DiagnosticSessionAggregate,
  FinalObjectiveSet,
  FrozenDimensionDiagnosis,
  StructuredQuestion,
} from "@/lib/bilan-sante/session-model";

export const SESSION_REPOSITORY_VERSION = "bilan-sante-v1";

type SessionRow = {
  id: string;
  user_id: string | null;
  status: string | null;
  phase: string | null;
  dimension: number | null;
  iteration: number | null;
  question_index: number | null;
  extracted_text: string | null;
  bilan_state_json: unknown | null;
  question_batch_json?: unknown | null;
  final_objectives_json?: unknown | null;
  consolidation_json?: unknown | null;
  diagnostic_result_json?: unknown | null;
  source_doc_path?: string | null;
  source_filename?: string | null;
  source_mime?: string | null;
  source_size_bytes?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type LegacyQuestionMirror = {
  fact_id: string;
  theme: string;
  constat: string;
  risque_managerial: string;
  question: string;
};

type SessionPatch = Partial<{
  status: string;
  phase: string;
  dimension: number | null;
  iteration: number | null;
  question_index: number;
  question_batch_json: LegacyQuestionMirror[];
  final_objectives_json: FinalObjectiveSet | null;
  consolidation_json: FrozenDimensionDiagnosis[];
  diagnostic_result_json: Record<string, unknown>;
  bilan_state_json: DiagnosticSessionAggregate | null;
  updated_at: string;
}>;

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidAggregate(raw: unknown): raw is DiagnosticSessionAggregate {
  if (!isObject(raw)) return false;

  return (
    typeof raw.sessionId === "string" &&
    typeof raw.phase === "string" &&
    Array.isArray(raw.frozenDimensions)
  );
}

function mapStatus(aggregate: DiagnosticSessionAggregate): string {
  switch (aggregate.phase) {
    case "awaiting_trame":
      return "collected";
    case "report_ready":
      return "report_ready";
    case "dimension_iteration":
    case "iteration_validation":
    case "final_objectives_validation":
      return "in_progress";
    default:
      return "in_progress";
  }
}

function mapLegacyQuestions(questions: StructuredQuestion[]): LegacyQuestionMirror[] {
  return questions.map((q) => ({
    fact_id: q.signalId,
    theme: q.theme,
    constat: q.constat,
    risque_managerial: q.risqueManagerial,
    question: q.questionOuverte,
  }));
}

function buildMirrorPatch(aggregate: DiagnosticSessionAggregate): SessionPatch {
  const questionCount = aggregate.currentWorkset?.questions.length ?? 0;
  const answeredCount = aggregate.currentWorkset?.answers.length ?? 0;
  const safeIndex = Math.max(
    0,
    Math.min(answeredCount, Math.max(questionCount - 1, 0))
  );

  return {
    status: mapStatus(aggregate),
    phase: aggregate.phase,
    dimension: aggregate.currentDimensionId,
    iteration: aggregate.currentIteration,
    question_index: safeIndex,
    question_batch_json: mapLegacyQuestions(aggregate.currentWorkset?.questions ?? []),
    final_objectives_json: aggregate.finalObjectives ?? null,
    consolidation_json: aggregate.frozenDimensions,
    bilan_state_json: deepClone(aggregate),
    updated_at: new Date().toISOString(),
  };
}

export async function loadSessionRow(sessionId: string): Promise<SessionRow | null> {
  const admin = adminSupabase();

  const { data, error } = await admin
    .from("diagnostic_sessions")
    .select(
      [
        "id",
        "user_id",
        "status",
        "phase",
        "dimension",
        "iteration",
        "question_index",
        "extracted_text",
        "bilan_state_json",
        "question_batch_json",
        "final_objectives_json",
        "consolidation_json",
        "diagnostic_result_json",
        "source_doc_path",
        "source_filename",
        "source_mime",
        "source_size_bytes",
        "created_at",
        "updated_at",
      ].join(",")
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw new Error(`SESSION_LOAD_FAILED: ${error.message}`);
  }

  return (data as SessionRow | null) ?? null;
}

export async function loadAggregate(
  sessionId: string
): Promise<{
  row: SessionRow;
  aggregate: DiagnosticSessionAggregate | null;
}> {
  const row = await loadSessionRow(sessionId);

  if (!row) {
    throw new Error("SESSION_NOT_FOUND");
  }

  const raw = row.bilan_state_json;

  if (!isValidAggregate(raw)) {
    return {
      row,
      aggregate: null,
    };
  }

  return {
    row,
    aggregate: deepClone(raw),
  };
}

export async function saveAggregate(
  sessionId: string,
  aggregate: DiagnosticSessionAggregate
): Promise<void> {
  const admin = adminSupabase();
  const patch = buildMirrorPatch(aggregate);

  const { error } = await admin
    .from("diagnostic_sessions")
    .update(patch)
    .eq("id", sessionId);

  if (error) {
    throw new Error(`SESSION_SAVE_FAILED: ${error.message}`);
  }
}

export async function markSessionFailed(
  sessionId: string,
  reason?: string
): Promise<void> {
  const admin = adminSupabase();

  const failurePayload = reason
    ? {
        failure_reason: reason,
        failed_at: new Date().toISOString(),
      }
    : {
        failure_reason: "Unknown failure",
        failed_at: new Date().toISOString(),
      };

  const { error } = await admin
    .from("diagnostic_sessions")
    .update({
      status: "failed",
      phase: "completed",
      question_batch_json: [],
      final_objectives_json: [],
      consolidation_json: [],
      diagnostic_result_json: failurePayload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`SESSION_MARK_FAILED: ${error.message}`);
  }
}

export async function appendDiagnosticEvent(params: {
  sessionId: string;
  userId: string;
  kind: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const admin = adminSupabase();

  const { error } = await admin.from("diagnostic_events").insert({
    session_id: params.sessionId,
    user_id: params.userId,
    kind: params.kind,
    payload: params.payload,
  });

  if (error) {
    throw new Error(`SESSION_EVENT_INSERT_FAILED: ${error.message}`);
  }
}