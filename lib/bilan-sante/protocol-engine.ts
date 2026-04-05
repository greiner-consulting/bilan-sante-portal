import {
  DIAGNOSTIC_PROTOCOL,
  buildIterationClosurePrompt,
  buildIterationCoverage,
  buildIterationHeader,
  getDimensionDefinition,
  getIterationRule,
  isCoverageSufficient,
  isLastDimension,
  isLastIteration,
  nextDimensionId,
  nextIterationNumber,
} from "@/lib/bilan-sante/protocol";
import {
  answeredQuestionIds,
  answersForCurrentIteration,
  cloneSessionState,
  createEmptySessionState,
  touchSession,
  type ActiveIterationState,
  type DiagnosticSessionState,
  type DiagnosticSignal,
  type DimensionId,
  type DriverAnswer,
  type FactType,
  type FrozenDimensionSnapshot,
  type FrozenIterationSummary,
  type InvestigationObject,
  type IterationNumber,
  type IterationValidationDecision,
  type QuestionBatch,
  type QuestionIntent,
  type SignalRegistry,
  type StructuredQuestion,
} from "@/lib/bilan-sante/session-model";

export interface EngineView {
  assistantMessage: string;
  questions: StructuredQuestion[];
  needsValidation: boolean;
  phase: DiagnosticSessionState["phase"];
  currentDimensionId: DimensionId | null;
  currentIteration: IterationNumber | null;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  return out;
}

function nowIso(): string {
  return new Date().toISOString();
}

function shortText(value: string, max = 180): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}...`;
}

function normalize(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function evidenceRank(value: InvestigationObject["evidenceStrength"]): number {
  if (value === "strong") return 3;
  if (value === "medium") return 2;
  return 1;
}

function pickIntent(
  iteration: IterationNumber,
  object: InvestigationObject
): QuestionIntent {
  const axes = object.explorationAxes.map(normalize);

  if (iteration === 1) {
    if (axes.some((item) => item.includes("depend"))) return "identify_dependency";
    return "open_core";
  }

  if (iteration === 2) {
    if (axes.some((item) => item.includes("seuil") || item.includes("threshold"))) {
      return "identify_threshold";
    }
    if (axes.some((item) => item.includes("depend"))) return "identify_dependency";
    return "clarify_mechanism";
  }

  if (axes.some((item) => item.includes("formal") || item.includes("cadre"))) {
    return "test_formalization";
  }
  if (axes.some((item) => item.includes("anticip"))) return "test_anticipation";
  return "validate_priority";
}

function buildQuestionText(
  intent: QuestionIntent,
  objectLabel: string
): string {
  switch (intent) {
    case "open_core":
      return `Aujourd'hui, comment ce sujet se passe-t-il concretement dans le fonctionnement reel sur "${objectLabel}" ?`;
    case "clarify_mechanism":
      return `Qu'est-ce qui explique principalement la situation actuelle sur "${objectLabel}", et par quel mecanisme cela se produit-il ?`;
    case "identify_threshold":
      return `A partir de quand la situation se tend-elle reellement sur "${objectLabel}", et quel est le point de bascule ?`;
    case "test_formalization":
      return `Sur "${objectLabel}", qu'est-ce qui est formalisé aujourd'hui et qu'est-ce qui repose encore sur les usages ?`;
    case "identify_dependency":
      return `Sur "${objectLabel}", de qui ou de quoi dependez-vous le plus pour tenir le sujet ?`;
    case "test_anticipation":
      return `Sur "${objectLabel}", comment les tensions ou besoins sont-ils anticipes avant de devenir un probleme ?`;
    case "confirm_strength":
      return `Sur "${objectLabel}", qu'est-ce qui fonctionne de maniere solide et reproductible aujourd'hui ?`;
    case "validate_priority":
      return `Au regard de l'ensemble, pourquoi ce sujet est-il prioritaire ou non sur "${objectLabel}" ?`;
    default:
      return `Pouvez-vous preciser ce point sur "${objectLabel}" ?`;
  }
}

function supportFactsForObject(
  object: InvestigationObject,
  signals: DiagnosticSignal[]
): string[] {
  const relevant = signals.filter((signal) =>
    object.supportingSignalIds.includes(signal.id)
  );

  return relevant.map((signal) => signal.factAtomic).filter(Boolean).slice(0, 3);
}

function buildQuestionForObject(input: {
  object: InvestigationObject;
  signals: DiagnosticSignal[];
  dimensionId: DimensionId;
  iteration: IterationNumber;
  index: number;
}): StructuredQuestion {
  const intent = pickIntent(input.iteration, input.object);
  const supportFacts = supportFactsForObject(input.object, input.signals);

  return {
    id: `q-${input.dimensionId}-${input.iteration}-${input.object.id}-${input.index}`,
    dimensionId: input.dimensionId,
    iteration: input.iteration,
    objectId: input.object.id,
    objectLabel: input.object.label,
    supportSignalIds: [...input.object.supportingSignalIds],
    supportFacts,
    questionIntent: intent,
    questionText: buildQuestionText(intent, input.object.label),
    askedBecause:
      supportFacts.length > 0
        ? `Question posee pour approfondir un objet deja appuye par la matiere disponible: ${shortText(
            supportFacts.join(" | "),
            190
          )}`
        : `Question posee pour approfondir l'objet d'enquete "${input.object.label}".`,
  };
}

function sortObjectsForIteration(
  objects: InvestigationObject[],
  iteration: IterationNumber
): InvestigationObject[] {
  return [...objects].sort((a, b) => {
    const scoreA =
      evidenceRank(a.evidenceStrength) * 10 +
      (a.status === "new" ? 3 : a.status === "in_progress" ? 2 : 1) +
      (a.coveredInIterations.includes(iteration) ? -3 : 0);
    const scoreB =
      evidenceRank(b.evidenceStrength) * 10 +
      (b.status === "new" ? 3 : b.status === "in_progress" ? 2 : 1) +
      (b.coveredInIterations.includes(iteration) ? -3 : 0);

    return scoreB - scoreA;
  });
}

function selectObjectsForIteration(input: {
  session: DiagnosticSessionState;
  dimensionId: DimensionId;
  iteration: IterationNumber;
  weakMatterMode: boolean;
}): InvestigationObject[] {
  const rule = getIterationRule(input.iteration, input.weakMatterMode);

  const pool = input.session.investigationObjects.filter(
    (item) => item.dimensionId === input.dimensionId && item.status !== "closed"
  );

  const ranked = sortObjectsForIteration(pool, input.iteration);

  return ranked.slice(0, rule.targetCount);
}

function buildQuestionBatch(input: {
  session: DiagnosticSessionState;
  dimensionId: DimensionId;
  iteration: IterationNumber;
  weakMatterMode: boolean;
}): QuestionBatch {
  const selectedObjects = selectObjectsForIteration(input);

  const questions = uniqueById(
    selectedObjects.map((object, index) =>
      buildQuestionForObject({
        object,
        signals: input.session.signals,
        dimensionId: input.dimensionId,
        iteration: input.iteration,
        index: index + 1,
      })
    )
  );

  return {
    dimensionId: input.dimensionId,
    iteration: input.iteration,
    questions,
  };
}

function buildActiveIterationState(input: {
  session: DiagnosticSessionState;
  dimensionId: DimensionId;
  iteration: IterationNumber;
  weakMatterMode: boolean;
}): ActiveIterationState {
  const batch = buildQuestionBatch(input);

  return {
    dimensionId: input.dimensionId,
    iteration: input.iteration,
    selectedObjectIds: batch.questions.map((item) => item.objectId),
    questionBatch: batch,
    openedAt: nowIso(),
    validationStatus: "in_progress",
  };
}

function dimensionObjects(
  session: DiagnosticSessionState,
  dimensionId: DimensionId
): InvestigationObject[] {
  return session.investigationObjects.filter((item) => item.dimensionId === dimensionId);
}

function dimensionSignals(
  session: DiagnosticSessionState,
  dimensionId: DimensionId
): DiagnosticSignal[] {
  return session.signals.filter((item) => item.dimensionId === dimensionId);
}

function inferWeakMatterMode(
  session: DiagnosticSessionState,
  dimensionId: DimensionId
): boolean {
  const objects = dimensionObjects(session, dimensionId);
  const strongOrMedium = objects.filter(
    (item) => item.evidenceStrength === "strong" || item.evidenceStrength === "medium"
  ).length;

  return strongOrMedium < 5;
}

function buildIterationSummary(input: {
  session: DiagnosticSessionState;
  dimensionId: DimensionId;
  iteration: IterationNumber;
}): FrozenIterationSummary {
  const questions = input.session.questions.filter(
    (item) => item.dimensionId === input.dimensionId && item.iteration === input.iteration
  );
  const answers = input.session.answers.filter(
    (item) => item.dimensionId === input.dimensionId && item.iteration === input.iteration
  );
  const exploredObjectIds = uniqueById(
    questions.map((item) => ({ id: item.objectId }))
  ).map((item) => item.id);

  const answerSummary = answers.map((item) => shortText(item.answerText, 100)).slice(0, 3);

  return {
    iteration: input.iteration,
    questionIds: questions.map((item) => item.id),
    answerIds: answers.map((item) => item.id),
    exploredObjectIds,
    summary:
      answerSummary.length > 0
        ? `Iteration ${input.iteration}: ${answerSummary.join(" | ")}`
        : `Iteration ${input.iteration}: exploration engagee sans synthese detaillee complementaire.`,
  };
}

function buildKeyFindings(
  session: DiagnosticSessionState,
  dimensionId: DimensionId
): string[] {
  const objects = dimensionObjects(session, dimensionId)
    .sort((a, b) => evidenceRank(b.evidenceStrength) - evidenceRank(a.evidenceStrength))
    .slice(0, 4);

  const findings = objects.map(
    (item) =>
      `${item.label} - ${shortText(item.supportSummary || "Objet d'enquete retenu car recurrent et suffisamment appuye.", 160)}`
  );

  return findings.length > 0
    ? findings
    : ["Matiere encore limitee: peu d'objets sont suffisamment etayes sur cette dimension."];
}

function buildNonPilotedAreas(
  session: DiagnosticSessionState,
  dimensionId: DimensionId
): string[] {
  const objects = dimensionObjects(session, dimensionId)
    .filter((item) =>
      item.explorationAxes.some((axis) => {
        const key = normalize(axis);
        return (
          key.includes("formal") ||
          key.includes("pilot") ||
          key.includes("anticip") ||
          key.includes("cadre")
        );
      })
    )
    .slice(0, 3);

  if (objects.length === 0) {
    return [
      "Peu de zones franchement non pilotees ressortent, mais plusieurs points restent a confirmer avant conclusion definitive.",
    ];
  }

  return objects.map(
    (item) =>
      `Zone a securiser: ${item.label} - ${shortText(item.supportSummary || "cadre de pilotage a confirmer", 150)}`
  );
}

function freezeDimension(
  session: DiagnosticSessionState,
  dimensionId: DimensionId,
  driverValidationNote?: string
): FrozenDimensionSnapshot {
  const salientSignals = dimensionSignals(session, dimensionId).slice(0, 8);
  const retainedObjects = dimensionObjects(session, dimensionId)
    .filter((item) => item.status !== "new")
    .slice(0, 6);

  return {
    dimensionId,
    frozenAt: nowIso(),
    iterationSummaries: [1, 2, 3].map((iteration) =>
      buildIterationSummary({
        session,
        dimensionId,
        iteration: iteration as IterationNumber,
      })
    ),
    salientSignalIds: salientSignals.map((item) => item.id),
    retainedObjectIds: retainedObjects.map((item) => item.id),
    keyFindings: buildKeyFindings(session, dimensionId),
    nonPilotedAreas: buildNonPilotedAreas(session, dimensionId),
    driverValidationNote,
  };
}

function markObjectsCovered(
  session: DiagnosticSessionState,
  objectIds: string[],
  iteration: IterationNumber
): InvestigationObject[] {
  return session.investigationObjects.map((item) => {
    if (!objectIds.includes(item.id)) return item;

    const covered = item.coveredInIterations.includes(iteration)
      ? item.coveredInIterations
      : [...item.coveredInIterations, iteration];

    return {
      ...item,
      coveredInIterations: covered,
      status:
        iteration === 3
          ? "sufficiently_explored"
          : item.status === "new"
          ? "in_progress"
          : item.status,
    };
  });
}

export function bootstrapSessionFromRegistry(input: {
  sessionId: string;
  registry: SignalRegistry;
}): DiagnosticSessionState {
  const firstDimension = DIAGNOSTIC_PROTOCOL.dimensions[0]?.id ?? null;
  const session = createEmptySessionState({
    sessionId: input.sessionId,
    protocolVersion: DIAGNOSTIC_PROTOCOL.version,
  });

  if (!firstDimension) {
    return touchSession(session);
  }

  const weakMatterMode = inferWeakMatterMode(
    {
      ...session,
      signals: input.registry.signals,
      investigationObjects: input.registry.investigationObjects,
    },
    firstDimension
  );

  const currentIterationState = buildActiveIterationState({
    session: {
      ...session,
      signals: input.registry.signals,
      investigationObjects: input.registry.investigationObjects,
    },
    dimensionId: firstDimension,
    iteration: 1,
    weakMatterMode,
  });

  return touchSession({
    ...session,
    phase: "dimension_iteration",
    signals: input.registry.signals,
    investigationObjects: input.registry.investigationObjects,
    currentDimensionId: firstDimension,
    currentIteration: 1,
    currentBatch: currentIterationState.questionBatch,
    currentIterationState,
    questions: [...currentIterationState.questionBatch.questions],
  });
}

export function getEngineView(session: DiagnosticSessionState): EngineView {
  if (session.phase === "awaiting_trame") {
    return {
      assistantMessage: "Le diagnostic ne peut pas demarrer sans matiere exploitable.",
      questions: [],
      needsValidation: false,
      phase: session.phase,
      currentDimensionId: null,
      currentIteration: null,
    };
  }

  if (session.phase === "iteration_validation" && session.currentIterationState) {
    return {
      assistantMessage: `${buildIterationHeader(
        session.currentIterationState.dimensionId,
        session.currentIterationState.iteration
      )}\n\n${buildIterationClosurePrompt(
        session.currentIterationState.dimensionId,
        session.currentIterationState.iteration
      )}`,
      questions: [],
      needsValidation: true,
      phase: session.phase,
      currentDimensionId: session.currentIterationState.dimensionId,
      currentIteration: session.currentIterationState.iteration,
    };
  }

  if (session.phase === "report_ready") {
    return {
      assistantMessage:
        "La session est stabilisee. Les dimensions ont ete traitees et le dossier est pret pour l'aval de synthese.",
      questions: [],
      needsValidation: false,
      phase: session.phase,
      currentDimensionId: null,
      currentIteration: null,
    };
  }

  if (!session.currentBatch) {
    return {
      assistantMessage: "Aucune iteration active trouvee.",
      questions: [],
      needsValidation: false,
      phase: session.phase,
      currentDimensionId: session.currentDimensionId,
      currentIteration: session.currentIteration,
    };
  }

  const dimension = getDimensionDefinition(session.currentBatch.dimensionId);

  return {
    assistantMessage: `${dimension.label} - iteration ${session.currentBatch.iteration}/3`,
    questions: session.currentBatch.questions,
    needsValidation: false,
    phase: session.phase,
    currentDimensionId: session.currentBatch.dimensionId,
    currentIteration: session.currentBatch.iteration,
  };
}

export function registerAnswer(input: {
  session: DiagnosticSessionState;
  questionId: string;
  answerText: string;
}): DiagnosticSessionState {
  const session = cloneSessionState(input.session);

  if (session.phase !== "dimension_iteration" || !session.currentIterationState) {
    throw new Error("La session n'est pas en phase de questions active.");
  }

  const question = session.currentIterationState.questionBatch.questions.find(
    (item) => item.id === input.questionId
  );

  if (!question) {
    throw new Error(`Question introuvable: ${input.questionId}`);
  }

  const alreadyAnswered = answeredQuestionIds(session).has(input.questionId);
  if (alreadyAnswered) {
    throw new Error(`La question ${input.questionId} a deja recu une reponse.`);
  }

  const answer: DriverAnswer = {
    id: `ans-${question.id}-${session.answers.length + 1}`,
    questionId: question.id,
    dimensionId: question.dimensionId,
    iteration: question.iteration,
    answerText: String(input.answerText ?? "").trim(),
    createdAt: nowIso(),
  };

  session.answers = [...session.answers, answer];

  const weakMatterMode = inferWeakMatterMode(session, question.dimensionId);
  const currentAnswers = answersForCurrentIteration({
    ...session,
    currentDimensionId: question.dimensionId,
    currentIteration: question.iteration,
  });

  const coverage = buildIterationCoverage({
    dimensionId: question.dimensionId,
    iteration: question.iteration,
    actualCount: currentAnswers.length,
    weakMatterMode,
  });

  session.coverage = [
    ...session.coverage.filter(
      (item) =>
        !(item.dimensionId === coverage.dimensionId && item.iteration === coverage.iteration)
    ),
    coverage,
  ];

  session.investigationObjects = markObjectsCovered(
    session,
    [question.objectId],
    question.iteration
  );

  const batchQuestionIds = new Set(
    session.currentIterationState.questionBatch.questions.map((item) => item.id)
  );
  const answersInBatch = session.answers.filter((item) => batchQuestionIds.has(item.questionId));

  if (
    answersInBatch.length >= coverage.minimumCount &&
    answersInBatch.length >= session.currentIterationState.questionBatch.questions.length
  ) {
    session.phase = "iteration_validation";
    session.currentIterationState = {
      ...session.currentIterationState,
      closureRequestedAt: nowIso(),
      validationStatus: "awaiting_validation",
    };
  }

  return touchSession(session);
}

export function submitIterationValidation(input: {
  session: DiagnosticSessionState;
  decision: IterationValidationDecision;
  note?: string;
}): DiagnosticSessionState {
  const session = cloneSessionState(input.session);

  if (session.phase !== "iteration_validation" || !session.currentIterationState) {
    throw new Error("La session n'attend pas de validation d'iteration.");
  }

  const current = session.currentIterationState;

  session.validationTraces = [
    ...session.validationTraces,
    {
      dimensionId: current.dimensionId,
      iteration: current.iteration,
      decision: input.decision,
      note: input.note,
      decidedAt: nowIso(),
    },
  ];

  if (input.decision === "reopen") {
    const weakMatterMode = inferWeakMatterMode(session, current.dimensionId);
    const reopened = buildActiveIterationState({
      session,
      dimensionId: current.dimensionId,
      iteration: current.iteration,
      weakMatterMode,
    });

    return touchSession({
      ...session,
      phase: "dimension_iteration",
      currentBatch: reopened.questionBatch,
      currentIterationState: reopened,
      questions: uniqueById([...session.questions, ...reopened.questionBatch.questions]),
    });
  }

  const validatedState: ActiveIterationState = {
    ...current,
    validatedAt: nowIso(),
    validationStatus: "validated",
  };

  const currentCoverage = session.coverage.find(
    (item) => item.dimensionId === current.dimensionId && item.iteration === current.iteration
  );

  if (currentCoverage && !isCoverageSufficient(currentCoverage)) {
    throw new Error("La couverture minimale de l'iteration n'est pas atteinte.");
  }

  if (!isLastIteration(current.iteration)) {
    const nextIteration = nextIterationNumber(current.iteration);
    if (!nextIteration) {
      throw new Error("Impossible de determiner l'iteration suivante.");
    }

    const weakMatterMode = inferWeakMatterMode(session, current.dimensionId);
    const nextState = buildActiveIterationState({
      session,
      dimensionId: current.dimensionId,
      iteration: nextIteration,
      weakMatterMode,
    });

    return touchSession({
      ...session,
      phase: "dimension_iteration",
      currentIteration: nextIteration,
      currentBatch: nextState.questionBatch,
      currentIterationState: nextState,
      questions: uniqueById([...session.questions, ...nextState.questionBatch.questions]),
    });
  }

  const frozen = freezeDimension(session, current.dimensionId, input.note);
  session.frozenDimensions = uniqueById([
    ...session.frozenDimensions.filter((item) => item.dimensionId !== current.dimensionId),
    frozen,
  ]);

  if (!isLastDimension(current.dimensionId)) {
    const nextDimension = nextDimensionId(current.dimensionId);
    if (!nextDimension) {
      throw new Error("Impossible de determiner la dimension suivante.");
    }

    const weakMatterMode = inferWeakMatterMode(session, nextDimension);
    const nextState = buildActiveIterationState({
      session,
      dimensionId: nextDimension,
      iteration: 1,
      weakMatterMode,
    });

    return touchSession({
      ...session,
      phase: "dimension_iteration",
      currentDimensionId: nextDimension,
      currentIteration: 1,
      currentBatch: nextState.questionBatch,
      currentIterationState: nextState,
      questions: uniqueById([...session.questions, ...nextState.questionBatch.questions]),
    });
  }

  return touchSession({
    ...session,
    phase: "report_ready",
    currentDimensionId: null,
    currentIteration: null,
    currentBatch: null,
    currentIterationState: null,
  });
}
