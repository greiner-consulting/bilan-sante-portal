// lib/bilan-sante/session-service.ts

import {
  answeredCount,
  bootstrapSessionFromTrame,
  captureObjectivesValidation,
  getEngineView,
  registerAnswer,
  submitIterationClosure,
} from "@/lib/bilan-sante/protocol-engine";
import type {
  DiagnosticSessionAggregate,
  StructuredQuestion,
} from "@/lib/bilan-sante/session-model";
import type { ObjectiveDecisionInput } from "@/lib/bilan-sante/objectives-builder";
import {
  appendDiagnosticEvent,
  loadAggregate,
  saveAggregate,
} from "@/lib/bilan-sante/session-repository";

type LegacyStructuredQuestion = {
  fact_id: string;
  theme: string;
  constat: string;
  risque_managerial: string;
  question: string;
};

export type SessionViewPayload = {
  assistant_message: string;
  questions: LegacyStructuredQuestion[];
  needs_validation: boolean;
  session: {
    id: string;
    user_id?: string;
    status: string;
    phase: string;
    dimension?: number | null;
    iteration?: number | null;
    question_index: number;
  };
};

function isYes(value: string): boolean {
  return ["oui", "ok", "valide", "validé", "yes"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function isNo(value: string): boolean {
  return ["non", "no"].includes(String(value || "").trim().toLowerCase());
}

function mapSessionStatus(session: DiagnosticSessionAggregate): string {
  switch (session.phase) {
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

function toLegacyQuestions(
  questions: StructuredQuestion[]
): LegacyStructuredQuestion[] {
  return questions.map((q) => ({
    fact_id: q.signalId,
    theme: q.theme,
    constat: q.constat,
    risque_managerial: q.risqueManagerial,
    question: q.questionOuverte,
  }));
}

function toSessionView(session: DiagnosticSessionAggregate): SessionViewPayload {
  const view = getEngineView(session);

  return {
    assistant_message: view.assistantMessage,
    questions: toLegacyQuestions(view.questions),
    needs_validation: view.needsValidation,
    session: {
      id: session.sessionId,
      status: mapSessionStatus(session),
      phase: session.phase,
      dimension: session.currentDimensionId,
      iteration: session.currentIteration,
      question_index: answeredCount(session),
    },
  };
}

function firstUnansweredQuestionId(
  session: DiagnosticSessionAggregate
): string | null {
  const workset = session.currentWorkset;
  if (!workset) return null;

  const answered = new Set(workset.answers.map((a) => a.questionId));
  const next = workset.questions.find((q) => !answered.has(q.id));
  return next?.id ?? null;
}

function buildObjectivesHelpMessage(
  session: DiagnosticSessionAggregate
): SessionViewPayload {
  const base = toSessionView(session);

  return {
    ...base,
    assistant_message:
      `${base.assistant_message}\n\n` +
      "Format accepté pour valider les objectifs :\n" +
      '- "oui" pour valider tous les objectifs proposés\n' +
      '- ou une ligne par objectif, par exemple :\n' +
      '  1: validé\n' +
      '  2: refusé\n' +
      '  3: ajusté | objectif=... | indicateur=... | echeance=90 jours | gain=... | quickwin=...',
  };
}

function parseObjectiveDecisionLine(
  line: string,
  objectives: Array<{ id: string }>
): ObjectiveDecisionInput | null {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;

  const match = trimmed.match(
    /^(\d+)\s*[:\-]?\s*(validé|valide|validated|ajusté|ajuste|adjusted|refusé|refuse|refused)\b/i
  );
  if (!match) return null;

  const index = Number(match[1]) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= objectives.length) {
    return null;
  }

  const statusToken = match[2].toLowerCase();
  const status =
    statusToken.startsWith("valid")
      ? "validated"
      : statusToken.startsWith("ajust") || statusToken.startsWith("adjust")
      ? "adjusted"
      : "refused";

  const rest = trimmed.slice(match[0].length).trim();
  const parts = rest
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);

  const extras = new Map<string, string>();

  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (!value) continue;
    extras.set(key, value);
  }

  return {
    objectiveId: objectives[index].id,
    status,
    adjustedLabel: extras.get("objectif"),
    adjustedIndicator: extras.get("indicateur"),
    adjustedDueDate: extras.get("echeance") ?? extras.get("échéance"),
    adjustedPotentialGain: extras.get("gain"),
    adjustedQuickWin: extras.get("quickwin"),
  };
}

function parseObjectiveDecisions(
  rawMessage: string,
  session: DiagnosticSessionAggregate
): ObjectiveDecisionInput[] {
  const message = String(rawMessage || "").trim();
  const objectives = session.finalObjectives?.objectives ?? [];

  if (objectives.length === 0) return [];

  if (isYes(message)) {
    return objectives.map((objective) => ({
      objectiveId: objective.id,
      status: "validated",
    }));
  }

  const lines = message
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const parsed = lines
    .map((line) => parseObjectiveDecisionLine(line, objectives))
    .filter(Boolean) as ObjectiveDecisionInput[];

  const seen = new Set<string>();
  const unique: ObjectiveDecisionInput[] = [];

  for (const item of parsed) {
    if (seen.has(item.objectiveId)) continue;
    seen.add(item.objectiveId);
    unique.push(item);
  }

  return unique;
}

async function ensureAggregate(sessionId: string): Promise<{
  row: Awaited<ReturnType<typeof loadAggregate>>["row"];
  aggregate: DiagnosticSessionAggregate;
}> {
  const loaded = await loadAggregate(sessionId);

  if (loaded.aggregate) {
    return {
      row: loaded.row,
      aggregate: loaded.aggregate,
    };
  }

  if (!loaded.row.extracted_text) {
    throw new Error("TRAME_NOT_INGESTED");
  }

  const aggregate = bootstrapSessionFromTrame({
    sessionId,
    rawTrameText: String(loaded.row.extracted_text),
  });

  await saveAggregate(sessionId, aggregate);

  return {
    row: loaded.row,
    aggregate,
  };
}

export async function bootstrapOrReadSession(params: {
  sessionId: string;
  userId: string;
}): Promise<SessionViewPayload> {
  const { aggregate } = await ensureAggregate(params.sessionId);
  const payload = toSessionView(aggregate);

  await appendDiagnosticEvent({
    sessionId: params.sessionId,
    userId: params.userId,
    kind: "CHAT_ASSISTANT",
    payload: {
      kind: "bootstrap_view",
      phase: aggregate.phase,
    },
  });

  return payload;
}

export async function processSessionInput(params: {
  sessionId: string;
  userId: string;
  message: string;
  objectiveDecisions?: ObjectiveDecisionInput[];
}): Promise<SessionViewPayload> {
  const rawMessage = String(params.message ?? "").trim();
  const { aggregate: initialAggregate } = await ensureAggregate(params.sessionId);

  let aggregate = initialAggregate;

  if (rawMessage) {
    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_USER",
      payload: {
        text: rawMessage,
        phase: aggregate.phase,
      },
    });
  }

  if (!rawMessage) {
    const payload = toSessionView(aggregate);

    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_ASSISTANT",
      payload: {
        ...payload,
        kind: "empty_message_view",
      },
    });

    return payload;
  }

  if (aggregate.phase === "report_ready") {
    const payload = toSessionView(aggregate);

    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_ASSISTANT",
      payload: {
        ...payload,
        kind: "report_ready_view",
      },
    });

    return payload;
  }

  if (aggregate.phase === "iteration_validation") {
    if (!isYes(rawMessage) && !isNo(rawMessage)) {
      const payload: SessionViewPayload = {
        ...toSessionView(aggregate),
        assistant_message:
          'Merci de répondre uniquement par "oui" ou "non" pour valider l’itération en cours.',
        questions: [],
        needs_validation: true,
      };

      await appendDiagnosticEvent({
        sessionId: params.sessionId,
        userId: params.userId,
        kind: "CHAT_ASSISTANT",
        payload: {
          ...payload,
          kind: "iteration_validation_help",
        },
      });

      return payload;
    }

    aggregate = submitIterationClosure({
      session: aggregate,
      decision: isYes(rawMessage) ? "yes" : "no",
    });

    await saveAggregate(params.sessionId, aggregate);

    const payload = toSessionView(aggregate);

    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_ASSISTANT",
      payload: {
        ...payload,
        kind: "iteration_closure_reply",
      },
    });

    return payload;
  }

  if (aggregate.phase === "final_objectives_validation") {
    const decisions =
      params.objectiveDecisions && params.objectiveDecisions.length > 0
        ? params.objectiveDecisions
        : parseObjectiveDecisions(rawMessage, aggregate);

    if (decisions.length === 0) {
      const payload = buildObjectivesHelpMessage(aggregate);

      await appendDiagnosticEvent({
        sessionId: params.sessionId,
        userId: params.userId,
        kind: "CHAT_ASSISTANT",
        payload: {
          ...payload,
          kind: "final_objectives_help",
        },
      });

      return payload;
    }

    aggregate = captureObjectivesValidation({
      session: aggregate,
      decisions,
    });

    await saveAggregate(params.sessionId, aggregate);

    const payload = toSessionView(aggregate);

    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_ASSISTANT",
      payload: {
        ...payload,
        kind: "final_objectives_reply",
      },
    });

    return payload;
  }

  if (aggregate.phase !== "dimension_iteration") {
    throw new Error(`UNSUPPORTED_SESSION_PHASE: ${aggregate.phase}`);
  }

  const questionId = firstUnansweredQuestionId(aggregate);

  if (!questionId) {
    const payload = toSessionView(aggregate);

    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_ASSISTANT",
      payload: {
        ...payload,
        kind: "no_unanswered_question",
      },
    });

    return payload;
  }

  aggregate = registerAnswer({
    session: aggregate,
    questionId,
    answerText: rawMessage,
  });

  await saveAggregate(params.sessionId, aggregate);

  const payload = toSessionView(aggregate);

  await appendDiagnosticEvent({
    sessionId: params.sessionId,
    userId: params.userId,
    kind: "CHAT_ASSISTANT",
    payload: {
      ...payload,
      kind: "dimension_reply",
    },
  });

  return payload;
}