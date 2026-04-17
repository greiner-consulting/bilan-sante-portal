import {
  answeredCount,
  bootstrapSessionFromTrameWithLlm,
  captureObjectivesValidation,
  challengeCurrentQuestion,
  getEngineView,
  registerAnswer,
  submitIterationClosure,
} from "@/lib/bilan-sante/protocol-engine";
import { analyzeUserAnswer } from "@/lib/bilan-sante/answer-analyzer";
import { registerAnswerInsight } from "@/lib/bilan-sante/coverage-tracker";
import type {
  ConversationTurn,
  DiagnosticSessionAggregate,
  DiagnosticSignal,
  EntryAngle,
  MemoryInsight,
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

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: string | null | undefined): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function shortenText(value: string | null | undefined, max = 140): string {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function uniqueBusinessFacts(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = normalizeForMatch(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out;
}

function isYes(value: string): boolean {
  return ["oui", "ok", "valide", "validé", "yes"].includes(
    normalizeText(value).toLowerCase()
  );
}

function isNo(value: string): boolean {
  return ["non", "no"].includes(normalizeText(value).toLowerCase());
}

function parseIterationValidationDecision(value: string): {
  decision: "yes" | "no" | null;
  nuance: boolean;
} {
  const raw = normalizeText(value);
  const normalized = normalizeForMatch(raw);

  if (!normalized) {
    return { decision: null, nuance: false };
  }

  const yesOnly = /^(oui|ok|yes|valide|validee?)$/i.test(normalized);
  if (yesOnly) {
    return { decision: "yes", nuance: false };
  }

  const noOnly = /^(non|no)$/i.test(normalized);
  if (noOnly) {
    return { decision: "no", nuance: false };
  }

  const yesNuancedPatterns = [
    /^oui\b.+/i,
    /^ok\b.+/i,
    /^yes\b.+/i,
    /^valide\b.+/i,
    /^validee?\b.+/i,
    /^oui\s+mais\b/i,
    /^ok\s+mais\b/i,
    /^oui\s+pas\b/i,
    /^oui\s+il\b/i,
    /^oui\s+reste\b/i,
    /^oui\s+manque\b/i,
    /^presque\b/i,
    /^pas\s+complet/i,
    /^pas\s+completement/i,
    /^pas\s+complètement/i,
  ];

  if (yesNuancedPatterns.some((pattern) => pattern.test(raw) || pattern.test(normalized))) {
    return { decision: "no", nuance: true };
  }

  const noNuancedPatterns = [
    /^non\b.+/i,
    /^pas\s+encore\b/i,
    /^pas\s+vraiment\b/i,
    /^pas\s+tout\s+a\s+fait\b/i,
    /^il\s+manque\b/i,
    /^reste\b.+/i,
  ];

  if (noNuancedPatterns.some((pattern) => pattern.test(raw) || pattern.test(normalized))) {
    return { decision: "no", nuance: true };
  }

  return { decision: null, nuance: false };
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

function getCurrentUnansweredQuestion(
  session: DiagnosticSessionAggregate
): StructuredQuestion | null {
  const workset = session.currentWorkset;
  if (!workset) return null;

  const answered = new Set(workset.answers.map((a) => a.questionId));
  return workset.questions.find((q) => !answered.has(q.id)) ?? null;
}

function getAllSignals(session: DiagnosticSessionAggregate): DiagnosticSignal[] {
  const registry = session.signalRegistry;
  if (!registry) return [];

  if ("all" in registry && Array.isArray(registry.all)) {
    return registry.all;
  }

  if ("allSignals" in registry && Array.isArray(registry.allSignals)) {
    return registry.allSignals;
  }

  return [
    ...registry.byDimension.d1,
    ...registry.byDimension.d2,
    ...registry.byDimension.d3,
    ...registry.byDimension.d4,
  ];
}

function findSignalById(
  session: DiagnosticSessionAggregate,
  signalId: string
): DiagnosticSignal | undefined {
  return getAllSignals(session).find((signal) => signal.id === signalId);
}

function getQuestionEntryAngle(
  session: DiagnosticSessionAggregate,
  question: StructuredQuestion
): EntryAngle | null {
  return findSignalById(session, question.signalId)?.entryAngle ?? null;
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
      "  1: validé\n" +
      "  2: refusé\n" +
      "  3: ajusté | objectif=... | indicateur=... | echeance=90 jours | gain=... | quickwin=...",
  };
}

function parseObjectiveDecisionLine(
  line: string,
  objectives: Array<{ id: string }>
): ObjectiveDecisionInput | null {
  const trimmed = normalizeText(line);
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
  const message = normalizeText(rawMessage);
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

function shouldRewriteCurrentQuestion(params: {
  intent: ReturnType<typeof analyzeUserAnswer>["intent"];
  shouldRephraseQuestion: boolean;
  shouldPivotAngle: boolean;
}): boolean {
  const { intent, shouldRephraseQuestion, shouldPivotAngle } = params;

  if (intent === "clarification_request") return true;
  if (intent === "challenge") return true;
  if (intent === "reframing") return true;
  if (intent === "noise") return true;

  if (intent === "mixed") return false;
  if (intent === "business_answer") return false;

  return shouldRephraseQuestion || shouldPivotAngle;
}

function analysisSignalsRedundancy(
  analysis: ReturnType<typeof analyzeUserAnswer>
): boolean {
  return [
    analysis.rawMessage,
    analysis.summary,
    analysis.rationale,
    ...(analysis.contradictionSignals ?? []),
  ].some((value) => {
    const text = normalizeForMatch(value);
    return (
      text.includes("redond") ||
      text.includes("meme question") ||
      text.includes("deja posee") ||
      text.includes("tourne en rond")
    );
  });
}

function analysisSignalsThemeMismatch(
  analysis: ReturnType<typeof analyzeUserAnswer>
): boolean {
  return [
    analysis.rawMessage,
    analysis.summary,
    analysis.rationale,
    ...(analysis.contradictionSignals ?? []),
  ].some((value) => {
    const text = normalizeForMatch(value);
    return (
      text.includes("pas le bon theme") ||
      text.includes("hors sujet") ||
      text.includes("decalage de theme") ||
      text.includes("mauvais angle") ||
      text.includes("mauvais sujet") ||
      text.includes("melange")
    );
  });
}

function buildRewriteAssistantMessage(
  analysis: ReturnType<typeof analyzeUserAnswer>
): string {
  if (analysis.intent === "clarification_request") {
    return "Je reformule la question plus simplement pour repartir sur le bon sujet.";
  }

  if (analysis.intent === "challenge" && analysisSignalsRedundancy(analysis)) {
    return "Je ne repose pas la même question. Je repars sur un autre angle utile, dans la limite du protocole.";
  }

  if (analysis.intent === "challenge" && analysisSignalsThemeMismatch(analysis)) {
    return "Je recentre la question sur le bon sujet avant de poursuivre le diagnostic.";
  }

  switch (analysis.intent) {
    case "challenge":
      return "Je corrige le cadrage de la question avant de poursuivre le diagnostic.";
    case "reframing":
      return "Je reprends la question selon l’angle que vous venez de recadrer.";
    case "noise":
      return "Je recentre la question avec un exemple plus concret pour poursuivre le diagnostic.";
    default:
      return "Je reformule la question pour poursuivre le diagnostic.";
  }
}

function ensureAnalysisMemory(
  session: DiagnosticSessionAggregate
): DiagnosticSessionAggregate {
  return {
    ...session,
    analysisMemory: session.analysisMemory ?? [],
    conversationHistory: session.conversationHistory ?? [],
    themeCoverage: session.themeCoverage ?? [],
  };
}

function appendAnswerAnalysisToMemory(params: {
  session: DiagnosticSessionAggregate;
  rawMessage: string;
  question: StructuredQuestion;
  analysis: ReturnType<typeof analyzeUserAnswer>;
}): DiagnosticSessionAggregate {
  const { session, rawMessage, question, analysis } = params;
  let nextSession = ensureAnalysisMemory(session);

  const extractedFacts =
    analysis.extractedFacts.length > 0
      ? analysis.extractedFacts
      : analysis.cleanedMessage.length >= 8 &&
        analysis.intent !== "clarification_request" &&
        analysis.intent !== "noise"
      ? [analysis.cleanedMessage]
      : [];

  const nextMemoryItem: MemoryInsight = {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    dimensionId: nextSession.currentDimensionId,
    iteration: nextSession.currentIteration,
    questionId: question.id,
    signalId: question.signalId,
    theme: question.theme,
    intent: analysis.intent,
    action: analysis.action,
    confidence: analysis.confidence,
    summary: analysis.summary,
    rationale: analysis.rationale,
    rawMessage,
    extractedFacts,
    detectedRootCauses: analysis.detectedRootCauses,
    reframingSignals: analysis.reframingSignals,
    contradictionSignals: analysis.contradictionSignals,
    suggestedAngle: analysis.suggestedAngle,
    shouldStoreAsAnswer: analysis.shouldStoreAsAnswer,
    shouldRephraseQuestion: analysis.shouldRephraseQuestion,
    shouldPivotAngle: analysis.shouldPivotAngle,
    isUsableBusinessMatter:
      analysis.isUsableBusinessMatter ||
      analysis.shouldStoreAsAnswer ||
      extractedFacts.length > 0 ||
      analysis.detectedRootCauses.length > 0,
  };

  nextSession = {
    ...nextSession,
    analysisMemory: [...(nextSession.analysisMemory ?? []), nextMemoryItem],
  };

  const askedAngle = getQuestionEntryAngle(nextSession, question);
  const confirmedAngle =
    analysis.isUsableBusinessMatter || analysis.shouldStoreAsAnswer
      ? analysis.suggestedAngle ?? askedAngle
      : null;
  const rejectedAngle =
    analysis.intent === "challenge" || analysis.intent === "reframing"
      ? askedAngle
      : null;

  if (nextSession.currentDimensionId && nextSession.currentIteration) {
    nextSession = registerAnswerInsight({
      session: nextSession,
      dimensionId: nextSession.currentDimensionId,
      iteration: nextSession.currentIteration,
      question,
      askedAngle,
      confirmedAngle,
      rejectedAngle,
      extractedFacts,
      note: analysis.summary,
    });
  }

  return nextSession;
}

function buildPrimaryAnswerText(params: {
  rawMessage: string;
  analysis: ReturnType<typeof analyzeUserAnswer>;
}): string {
  const { rawMessage, analysis } = params;

  const cleaned = normalizeText(analysis.cleanedMessage);
  const facts = uniqueBusinessFacts(analysis.extractedFacts);

  if (analysis.shouldStoreAsAnswer && cleaned.length >= 12) {
    return cleaned;
  }

  if (facts.length === 1) {
    return facts[0];
  }

  if (facts.length >= 2) {
    return facts.slice(0, 2).join(" | ");
  }

  return normalizeText(rawMessage);
}

function shortAcknowledgementFact(value: string): string {
  const text = normalizeText(value).replace(/[.!?]+$/, "");
  return shortenText(text, 140);
}

function renderRootCauseLabel(value: string): string {
  switch (value) {
    case "skills":
      return "un problème de compétences ou d’expérience";
    case "experience":
      return "un manque d’expérience";
    case "decision":
      return "des décisions tardives ou insuffisamment sécurisées";
    case "arbitration":
      return "des arbitrages insuffisamment clarifiés";
    case "organization":
      return "un sujet d’organisation ou de répartition des rôles";
    case "resources":
      return "une tension de ressources ou de capacité";
    case "pricing":
      return "un sujet de prix ou de rentabilité";
    case "cash":
      return "un sujet de trésorerie ou d’impact économique";
    default:
      return "un facteur structurel à préciser";
  }
}

function buildFollowUpAcknowledgement(params: {
  analysis: ReturnType<typeof analyzeUserAnswer>;
  question: StructuredQuestion;
}): string | null {
  const { analysis, question } = params;
  const facts = uniqueBusinessFacts(analysis.extractedFacts);

  if (facts.length > 0) {
    return `Je retiens notamment ceci sur "${question.theme}" : ${shortAcknowledgementFact(
      facts[0]
    )}.`;
  }

  if (analysis.summary && normalizeText(analysis.summary).length >= 12) {
    return `Je retiens sur "${question.theme}" : ${shortAcknowledgementFact(
      analysis.summary
    )}.`;
  }

  if (analysis.detectedRootCauses.length > 0) {
    return `Je note que sur "${question.theme}", le sujet semble surtout lié à ${renderRootCauseLabel(
      analysis.detectedRootCauses[0]
    )}.`;
  }

  return null;
}

function mergeAcknowledgementIntoPayload(params: {
  payload: SessionViewPayload;
  acknowledgement: string | null;
}): SessionViewPayload {
  const { payload, acknowledgement } = params;
  if (!acknowledgement) return payload;

  const assistantMessage = normalizeText(payload.assistant_message);
  if (!assistantMessage) return payload;

  return {
    ...payload,
    assistant_message: `${acknowledgement}\n\n${assistantMessage}`,
  };
}

function turnId(prefix: string, parts: Array<string | number | null | undefined>): string {
  const raw = parts.map((item) => normalizeText(String(item ?? ""))).join("|");
  const normalized = normalizeForMatch(raw)
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 120);
  return `${prefix}-${normalized || "item"}`;
}

function appendConversationTurn(
  session: DiagnosticSessionAggregate,
  turn: ConversationTurn
): DiagnosticSessionAggregate {
  const history = session.conversationHistory ?? [];
  if (history.some((item) => item.id === turn.id)) {
    return session;
  }

  return {
    ...session,
    conversationHistory: [...history, turn],
  };
}

function appendUserTurn(
  session: DiagnosticSessionAggregate,
  text: string
): DiagnosticSessionAggregate {
  const workset = session.currentWorkset;
  const currentQuestion = getCurrentUnansweredQuestion(session);

  return appendConversationTurn(session, {
    id: turnId("user", [
      session.phase,
      workset?.dimensionId,
      workset?.iteration,
      text,
      workset?.answers.length ?? 0,
    ]),
    createdAt: new Date().toISOString(),
    role: "user",
    text,
    kind: "user_message",
    phase: session.phase,
    dimensionId: workset?.dimensionId ?? null,
    iteration: workset?.iteration ?? null,
    questionId: currentQuestion?.id ?? null,
    signalId: currentQuestion?.signalId ?? null,
    theme: currentQuestion?.theme ?? null,
  });
}

function syncAssistantPayloadIntoConversation(params: {
  session: DiagnosticSessionAggregate;
  payload: SessionViewPayload;
  kind: string;
}): DiagnosticSessionAggregate {
  let session = params.session;
  const phase = session.phase;
  const dimensionId = session.currentDimensionId;
  const iteration = session.currentIteration;

  const assistantMessage = normalizeText(params.payload.assistant_message);
  if (assistantMessage) {
    session = appendConversationTurn(session, {
      id: turnId("assistant", [params.kind, phase, dimensionId, iteration, assistantMessage]),
      createdAt: new Date().toISOString(),
      role: "assistant",
      text: assistantMessage,
      kind: params.kind,
      phase,
      dimensionId,
      iteration,
    });
  }

  const questions = params.payload.questions ?? [];
  const total = questions.length;

  questions.forEach((question, index) => {
    session = appendConversationTurn(session, {
      id: turnId("question", [question.fact_id, phase, dimensionId, iteration, question.question]),
      createdAt: new Date().toISOString(),
      role: "question",
      text: question.question,
      kind: "structured_question",
      phase,
      dimensionId,
      iteration,
      questionId: session.currentWorkset?.questions[index]?.id ?? null,
      signalId: question.fact_id ?? null,
      theme: question.theme ?? null,
      ordinal: index + 1,
      total,
    });
  });

  return session;
}

function aggregateNeedsRecovery(params: {
  row: { extracted_text: string | null; phase?: string | null };
  aggregate: DiagnosticSessionAggregate | null;
}): boolean {
  if (!params.row.extracted_text) return false;
  if (!params.aggregate) return true;

  if (params.aggregate.phase === "awaiting_trame") return true;

  if (
    params.aggregate.phase === "dimension_iteration" &&
    (!params.aggregate.currentWorkset ||
      (params.aggregate.currentWorkset.questions?.length ?? 0) === 0)
  ) {
    return true;
  }

  if (
    params.aggregate.phase === "iteration_validation" &&
    !params.aggregate.currentWorkset
  ) {
    return true;
  }

  return false;
}

export async function ensureAggregate(sessionId: string): Promise<{
  row: Awaited<ReturnType<typeof loadAggregate>>["row"];
  aggregate: DiagnosticSessionAggregate;
}> {
  const loaded = await loadAggregate(sessionId);

  if (!loaded.row.extracted_text) throw new Error("TRAME_NOT_INGESTED");

  if (!aggregateNeedsRecovery({ row: loaded.row, aggregate: loaded.aggregate })) {
    return { row: loaded.row, aggregate: loaded.aggregate as DiagnosticSessionAggregate };
  }

  const aggregate = await bootstrapSessionFromTrameWithLlm({
    sessionId,
    rawTrameText: String(loaded.row.extracted_text),
  });

  await saveAggregate(sessionId, aggregate);
  return { row: loaded.row, aggregate };
}

export async function bootstrapOrReadSession(params: {
  sessionId: string;
  userId: string;
}): Promise<SessionViewPayload> {
  let { aggregate } = await ensureAggregate(params.sessionId);
  let payload = toSessionView(aggregate);

  aggregate = syncAssistantPayloadIntoConversation({
    session: aggregate,
    payload,
    kind: "bootstrap_view",
  });
  await saveAggregate(params.sessionId, aggregate);
  payload = toSessionView(aggregate);

  await appendDiagnosticEvent({
    sessionId: params.sessionId,
    userId: params.userId,
    kind: "CHAT_ASSISTANT",
    payload: { kind: "bootstrap_view", phase: aggregate.phase },
  });

  return payload;
}

export async function processSessionInput(params: {
  sessionId: string;
  userId: string;
  message: string;
  objectiveDecisions?: ObjectiveDecisionInput[];
}): Promise<SessionViewPayload> {
  const rawMessage = normalizeText(params.message);
  const { aggregate: initialAggregate } = await ensureAggregate(params.sessionId);
  let aggregate = ensureAnalysisMemory(initialAggregate);

  if (rawMessage) {
    aggregate = appendUserTurn(aggregate, rawMessage);
    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_USER",
      payload: { text: rawMessage, phase: aggregate.phase },
    });
  }

  if (!rawMessage) {
    let payload = toSessionView(aggregate);
    aggregate = syncAssistantPayloadIntoConversation({
      session: aggregate,
      payload,
      kind: "empty_message_view",
    });
    await saveAggregate(params.sessionId, aggregate);
    payload = toSessionView(aggregate);
    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_ASSISTANT",
      payload: { ...payload, kind: "empty_message_view" },
    });
    return payload;
  }

  if (aggregate.phase === "report_ready") {
    let payload = toSessionView(aggregate);
    aggregate = syncAssistantPayloadIntoConversation({
      session: aggregate,
      payload,
      kind: "report_ready_view",
    });
    await saveAggregate(params.sessionId, aggregate);
    payload = toSessionView(aggregate);
    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_ASSISTANT",
      payload: { ...payload, kind: "report_ready_view" },
    });
    return payload;
  }

  if (aggregate.phase === "iteration_validation") {
    const validation = parseIterationValidationDecision(rawMessage);

    if (!validation.decision) {
      const payload: SessionViewPayload = {
        ...toSessionView(aggregate),
        assistant_message:
          "J’ai besoin de savoir si cette itération peut être considérée comme validée. " +
          'Vous pouvez répondre par "oui" ou "non". Si certains points manquent encore, dites-le librement et je poursuivrai l’exploration.',
        questions: [],
        needs_validation: true,
      };

      aggregate = syncAssistantPayloadIntoConversation({
        session: aggregate,
        payload,
        kind: "iteration_validation_help",
      });
      await saveAggregate(params.sessionId, aggregate);
      await appendDiagnosticEvent({
        sessionId: params.sessionId,
        userId: params.userId,
        kind: "CHAT_ASSISTANT",
        payload: { ...payload, kind: "iteration_validation_help" },
      });
      return payload;
    }

    aggregate = await submitIterationClosure({
      session: aggregate,
      decision: validation.decision,
    });

    let payload = toSessionView(aggregate);

    if (validation.nuance && validation.decision === "no") {
      payload = {
        ...payload,
        assistant_message:
          "Je comprends qu’il reste des points à compléter sur cette itération. " +
          "Je poursuis donc l’exploration avant clôture.",
      };
    }

    aggregate = syncAssistantPayloadIntoConversation({
      session: aggregate,
      payload,
      kind: "iteration_closure_reply",
    });
    await saveAggregate(params.sessionId, aggregate);
    payload = toSessionView(aggregate);

    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_ASSISTANT",
      payload: {
        ...payload,
        kind: "iteration_closure_reply",
        validation_decision: validation.decision,
        validation_nuance: validation.nuance,
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
      aggregate = syncAssistantPayloadIntoConversation({
        session: aggregate,
        payload,
        kind: "final_objectives_help",
      });
      await saveAggregate(params.sessionId, aggregate);
      await appendDiagnosticEvent({
        sessionId: params.sessionId,
        userId: params.userId,
        kind: "CHAT_ASSISTANT",
        payload: { ...payload, kind: "final_objectives_help" },
      });
      return payload;
    }

    aggregate = captureObjectivesValidation({ session: aggregate, decisions });
    let payload = toSessionView(aggregate);
    aggregate = syncAssistantPayloadIntoConversation({
      session: aggregate,
      payload,
      kind: "final_objectives_reply",
    });
    await saveAggregate(params.sessionId, aggregate);
    payload = toSessionView(aggregate);
    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_ASSISTANT",
      payload: { ...payload, kind: "final_objectives_reply" },
    });
    return payload;
  }

  if (aggregate.phase !== "dimension_iteration") {
    throw new Error(`UNSUPPORTED_SESSION_PHASE: ${aggregate.phase}`);
  }

  const currentQuestion = getCurrentUnansweredQuestion(aggregate);
  const questionId = currentQuestion?.id ?? firstUnansweredQuestionId(aggregate);

  if (!questionId || !currentQuestion) {
    let payload = toSessionView(aggregate);
    aggregate = syncAssistantPayloadIntoConversation({
      session: aggregate,
      payload,
      kind: "no_unanswered_question",
    });
    await saveAggregate(params.sessionId, aggregate);
    payload = toSessionView(aggregate);
    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_ASSISTANT",
      payload: { ...payload, kind: "no_unanswered_question" },
    });
    return payload;
  }

  const analysis = analyzeUserAnswer({
    rawMessage,
    currentQuestion: {
      theme: currentQuestion.theme,
      constat: currentQuestion.constat,
      questionOuverte: currentQuestion.questionOuverte,
      entryAngle: getQuestionEntryAngle(aggregate, currentQuestion),
    },
  });

  aggregate = appendAnswerAnalysisToMemory({
    session: aggregate,
    rawMessage,
    question: currentQuestion,
    analysis,
  });

  if (
    shouldRewriteCurrentQuestion({
      intent: analysis.intent,
      shouldRephraseQuestion: analysis.shouldRephraseQuestion,
      shouldPivotAngle: analysis.shouldPivotAngle,
    })
  ) {
    aggregate = (await challengeCurrentQuestion({
      session: aggregate,
      rawMessage,
      reason: analysis.intent,
    })) as DiagnosticSessionAggregate;

    const payload: SessionViewPayload = {
      ...toSessionView(aggregate),
      assistant_message: buildRewriteAssistantMessage(analysis),
      needs_validation: false,
    };

    aggregate = syncAssistantPayloadIntoConversation({
      session: aggregate,
      payload,
      kind: "question_rephrased",
    });
    await saveAggregate(params.sessionId, aggregate);

    await appendDiagnosticEvent({
      sessionId: params.sessionId,
      userId: params.userId,
      kind: "CHAT_ASSISTANT",
      payload: {
        ...payload,
        kind: "question_rephrased",
        analysis_intent: analysis.intent,
        analysis_summary: analysis.summary,
        analysis_rationale: analysis.rationale,
        extracted_facts: analysis.extractedFacts,
        detected_root_causes: analysis.detectedRootCauses,
        suggested_angle: analysis.suggestedAngle,
      },
    });

    return payload;
  }

  const primaryAnswerText = buildPrimaryAnswerText({
    rawMessage,
    analysis,
  });

  const acknowledgement = buildFollowUpAcknowledgement({
    analysis,
    question: currentQuestion,
  });

  aggregate = registerAnswer({
    session: aggregate,
    questionId,
    answerText: primaryAnswerText,
  });

  let payload = toSessionView(aggregate);
  payload = mergeAcknowledgementIntoPayload({
    payload,
    acknowledgement,
  });

  aggregate = syncAssistantPayloadIntoConversation({
    session: aggregate,
    payload,
    kind: "dimension_reply",
  });
  await saveAggregate(params.sessionId, aggregate);
  payload = toSessionView(aggregate);

  await appendDiagnosticEvent({
    sessionId: params.sessionId,
    userId: params.userId,
    kind: "CHAT_ASSISTANT",
    payload: {
      ...payload,
      kind: "dimension_reply",
      analysis_intent: analysis.intent,
      analysis_summary: analysis.summary,
      analysis_rationale: analysis.rationale,
      extracted_facts: analysis.extractedFacts,
      detected_root_causes: analysis.detectedRootCauses,
      suggested_angle: analysis.suggestedAngle,
      memory_written: true,
      stored_answer_text: primaryAnswerText,
    },
  });

  return payload;
}
