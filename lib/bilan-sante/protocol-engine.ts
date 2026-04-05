// lib/bilan-sante/protocol-engine.ts

import {
  DIAGNOSTIC_PROTOCOL,
  buildIterationCoverage,
  getDimensionDefinition,
  getIterationRule,
  isCoverageSufficient,
} from "@/lib/bilan-sante/protocol";
import type {
  DiagnosticSessionState,
  DiagnosticSignal,
  DimensionId,
  DriverAnswer,
  InvestigationObject,
  IterationCoverage,
  IterationNumber,
  QuestionBatch,
  QuestionIntent,
  SignalRegistry,
  StructuredQuestion,
} from "@/lib/bilan-sante/session-model";

export type IterationValidationDecision = "validate" | "reopen";

export interface IterationValidationTrace {
  dimensionId: DimensionId;
  iteration: IterationNumber;
  decision: IterationValidationDecision;
  note?: string;
  decidedAt: string;
}

export interface FrozenIterationSummary {
  iteration: IterationNumber;
  questionIds: string[];
  exploredObjectIds: string[];
  summary: string;
}

export interface FrozenDimensionSnapshot {
  dimensionId: DimensionId;
  frozenAt: string;
  iterationSummaries: FrozenIterationSummary[];
  salientSignalIds: string[];
  retainedObjectIds: string[];
  keyFindings: string[];
  nonPilotedAreas: string[];
  driverValidationNote?: string;
}

export interface ActiveIterationState {
  dimensionId: DimensionId;
  iteration: IterationNumber;
  selectedObjectIds: string[];
  questionBatch: QuestionBatch;
  openedAt: string;
  closureRequestedAt?: string;
  validatedAt?: string;
  validationStatus: "in_progress" | "awaiting_validation" | "validated";
}

export type EnginePhase =
  | "awaiting_trame"
  | "dimension_iteration"
  | "iteration_validation"
  | "final_review"
  | "report_ready";

export interface DiagnosticSessionEngineState extends DiagnosticSessionState {
  phase: EnginePhase;
  currentBatch: QuestionBatch | null;
  currentIterationState: ActiveIterationState | null;
  frozenDimensions: FrozenDimensionSnapshot[];
  validationHistory: IterationValidationTrace[];
  createdAt: string;
  updatedAt: string;
}

export interface EngineView {
  assistantMessage: string;
  questions: StructuredQuestion[];
  needsValidation: boolean;
  phase: EnginePhase;
  currentDimensionId: DimensionId | null;
  currentIteration: IterationNumber | null;
}

const DIMENSION_SEQUENCE: DimensionId[] = DIAGNOSTIC_PROTOCOL.dimensions.map(
  (item) => item.id
);

function nowIso(): string {
  return new Date().toISOString();
}

function cloneArray<T>(items: T[] | undefined | null): T[] {
  return Array.isArray(items) ? [...items] : [];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value: unknown): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function dimensionOrder(dimensionId: DimensionId): number {
  return DIMENSION_SEQUENCE.findIndex((item) => item === dimensionId);
}

function nextDimensionId(
  current: DimensionId | null
): DimensionId | null {
  if (!current) return DIMENSION_SEQUENCE[0] ?? null;

  const index = DIMENSION_SEQUENCE.findIndex((item) => item === current);
  if (index < 0) return null;

  return DIMENSION_SEQUENCE[index + 1] ?? null;
}

function nextIterationNumber(
  current: IterationNumber | null
): IterationNumber | null {
  if (current === 1) return 2;
  if (current === 2) return 3;
  return null;
}

function isLastIteration(iteration: IterationNumber): boolean {
  return iteration === 3;
}

function isLastDimension(dimensionId: DimensionId): boolean {
  return nextDimensionId(dimensionId) === null;
}

function createQuestionId(
  dimensionId: DimensionId,
  iteration: IterationNumber,
  objectId: string,
  index: number
): string {
  return `q-${dimensionId}-it${iteration}-${objectId}-${index}`;
}

function createSessionIdSafe(value: string): string {
  const text = normalizeText(value);
  return text || `session-${Date.now()}`;
}

function compactSummary(text: string, max = 220): string {
  const clean = normalizeText(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function findSignalsForObject(
  signals: DiagnosticSignal[],
  objectId: string
): DiagnosticSignal[] {
  return signals.filter((signal) => signal.id && signal.id === objectId);
}

function findSupportingSignals(
  signals: DiagnosticSignal[],
  object: InvestigationObject
): DiagnosticSignal[] {
  const supportingIds = new Set(object.supportingSignalIds ?? []);
  return signals.filter((signal) => supportingIds.has(signal.id));
}

function strongestEvidenceRank(value: InvestigationObject["evidenceStrength"]): number {
  if (value === "strong") return 3;
  if (value === "medium") return 2;
  return 1;
}

function deriveIntent(iteration: IterationNumber, object: InvestigationObject): QuestionIntent {
  const axes = (object.explorationAxes ?? []).map((item) => normalizeKey(item));
  const summary = normalizeKey(object.supportSummary);

  if (iteration === 1) {
    return "open_core";
  }

  if (iteration === 2) {
    if (axes.some((item) => item.includes("seuil")) || summary.includes("seuil")) {
      return "identify_threshold";
    }
    if (axes.some((item) => item.includes("depend")) || summary.includes("depend")) {
      return "identify_dependency";
    }
    return "clarify_mechanism";
  }

  if (
    axes.some((item) => item.includes("formal")) ||
    summary.includes("formal") ||
    summary.includes("cadre") ||
    summary.includes("rituel")
  ) {
    return "test_formalization";
  }

  if (
    axes.some((item) => item.includes("anticip")) ||
    summary.includes("anticip")
  ) {
    return "test_anticipation";
  }

  return "validate_priority";
}

function buildQuestionText(
  object: InvestigationObject,
  intent: QuestionIntent
): string {
  const label = normalizeText(object.label);

  switch (intent) {
    case "open_core":
      return `Aujourd’hui, comment ce sujet se passe-t-il concrètement dans le fonctionnement réel : ${label} ?`;

    case "clarify_mechanism":
      return `Aujourd’hui, sur ${label}, par quel mécanisme la situation se produit-elle réellement ?`;

    case "identify_threshold":
      return `Aujourd’hui, sur ${label}, à partir de quel seuil ou de quelle situation cela se tend-il réellement ?`;

    case "test_formalization":
      return `Aujourd’hui, sur ${label}, qu’est-ce qui est réellement formalisé, et qu’est-ce qui repose encore surtout sur les usages ?`;

    case "identify_dependency":
      return `Aujourd’hui, sur ${label}, de qui ou de quoi dépend-on le plus pour que cela tienne ?`;

    case "test_anticipation":
      return `Aujourd’hui, sur ${label}, comment ce point est-il anticipé en amont lorsqu’il commence à dériver ?`;

    case "confirm_strength":
      return `Aujourd’hui, sur ${label}, qu’est-ce qui fonctionne bien de manière réellement fiable ?`;

    case "validate_priority":
      return `Parmi les sujets liés à ${label}, quel est celui qui doit être traité en priorité pour sécuriser le fonctionnement ?`;

    default:
      return `Pouvez-vous préciser concrètement ce point : ${label} ?`;
  }
}

function buildAskedBecause(
  object: InvestigationObject,
  signals: DiagnosticSignal[],
  iteration: IterationNumber
): string {
  const supportingSignals = findSupportingSignals(signals, object);
  const evidence = object.evidenceStrength;
  const becauseBase =
    iteration === 1
      ? "Cet objet est retenu car il ressort déjà de la trame comme un point structurant à comprendre dans le fonctionnement réel."
      : iteration === 2
      ? "Cet objet est repris car son mécanisme ou ses dépendances doivent encore être clarifiés à partir de la matière déjà recueillie."
      : "Cet objet est repris pour consolider ce qui reste insuffisamment piloté, anticipé ou formalisé.";

  const supportDetail =
    supportingSignals.length > 0
      ? ` Il s’appuie sur ${supportingSignals.length} signal(s) support avec un niveau de preuve ${evidence}.`
      : ` Il reste suivi malgré une matière encore ${evidence}.`;

  return `${becauseBase}${supportDetail}`;
}

function buildStructuredQuestion(
  object: InvestigationObject,
  iteration: IterationNumber,
  index: number,
  signals: DiagnosticSignal[]
): StructuredQuestion {
  const intent = deriveIntent(iteration, object);
  const supportingSignals = findSupportingSignals(signals, object);

  return {
    id: createQuestionId(object.dimensionId, iteration, object.id, index),
    dimensionId: object.dimensionId,
    iteration,
    objectId: object.id,
    objectLabel: object.label,
    supportSignalIds: cloneArray(object.supportingSignalIds),
    supportFacts: supportingSignals.map((signal) => signal.factAtomic),
    questionIntent: intent,
    questionText: buildQuestionText(object, intent),
    askedBecause: buildAskedBecause(object, signals, iteration),
  };
}

function scoreObjectForIteration(
  object: InvestigationObject,
  iteration: IterationNumber,
  signals: DiagnosticSignal[],
  answers: DriverAnswer[],
  frozenDimensionIds: Set<DimensionId>
): number {
  if (frozenDimensionIds.has(object.dimensionId)) return Number.NEGATIVE_INFINITY;

  let score = strongestEvidenceRank(object.evidenceStrength) * 100;

  if (object.status === "new") score += 20;
  if (object.status === "in_progress") score += 10;
  if (object.status === "sufficiently_explored") score -= 10;
  if (object.status === "closed") score -= 40;

  const alreadyCovered = (object.coveredInIterations ?? []).includes(iteration);
  if (alreadyCovered) score -= 25;

  const explorationAxes = (object.explorationAxes ?? []).map((item) => normalizeKey(item));
  const objectSignals = findSupportingSignals(signals, object);
  const hasDriverMemory = objectSignals.some(
    (signal) => signal.sourceOrigin === "dirigeant_memory"
  );

  if (iteration === 1) {
    if (object.evidenceStrength === "strong") score += 25;
    if (object.evidenceStrength === "medium") score += 10;
  }

  if (iteration === 2) {
    if (hasDriverMemory) score += 30;
    if (explorationAxes.some((item) => item.includes("seuil"))) score += 12;
    if (explorationAxes.some((item) => item.includes("depend"))) score += 12;
    if (explorationAxes.some((item) => item.includes("declenche"))) score += 10;
  }

  if (iteration === 3) {
    if (explorationAxes.some((item) => item.includes("formal"))) score += 18;
    if (explorationAxes.some((item) => item.includes("pilot"))) score += 14;
    if (explorationAxes.some((item) => item.includes("anticip"))) score += 12;
  }

  const objectAnswerCount = answers.filter(
    (answer) => answer.dimensionId === object.dimensionId
  ).length;
  score += Math.min(objectAnswerCount, 10);

  return score;
}

function selectObjectsForIteration(params: {
  state: DiagnosticSessionEngineState;
  dimensionId: DimensionId;
  iteration: IterationNumber;
}): InvestigationObject[] {
  const frozenDimensionIds = new Set(
    params.state.frozenDimensions.map((item) => item.dimensionId)
  );

  const objects = params.state.investigationObjects.filter(
    (item) => item.dimensionId === params.dimensionId
  );

  const weakMatterMode =
    objects.filter((item) => item.evidenceStrength === "strong" || item.evidenceStrength === "medium")
      .length < getIterationRule(1, false).minimumCount;

  const rule = getIterationRule(params.iteration, weakMatterMode);

  const ranked = [...objects]
    .map((object) => ({
      object,
      score: scoreObjectForIteration(
        object,
        params.iteration,
        params.state.signals,
        params.state.answers,
        frozenDimensionIds
      ),
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.object);

  return ranked.slice(0, rule.targetCount);
}

function buildQuestionBatch(params: {
  state: DiagnosticSessionEngineState;
  dimensionId: DimensionId;
  iteration: IterationNumber;
}): QuestionBatch {
  const selectedObjects = selectObjectsForIteration(params);

  const questions = selectedObjects.map((object, index) =>
    buildStructuredQuestion(
      object,
      params.iteration,
      index + 1,
      params.state.signals
    )
  );

  return {
    dimensionId: params.dimensionId,
    iteration: params.iteration,
    questions,
  };
}

function createEmptyEngineState(sessionId: string): DiagnosticSessionEngineState {
  const now = nowIso();

  return {
    sessionId: createSessionIdSafe(sessionId),
    protocolVersion: DIAGNOSTIC_PROTOCOL.version,
    phase: "awaiting_trame",
    signals: [],
    investigationObjects: [],
    questions: [],
    answers: [],
    coverage: [],
    currentDimensionId: null,
    currentIteration: null,
    currentBatch: null,
    currentIterationState: null,
    frozenDimensions: [],
    validationHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

function touchState(state: DiagnosticSessionEngineState): DiagnosticSessionEngineState {
  return {
    ...state,
    updatedAt: nowIso(),
  };
}

function mergeCoverage(
  coverage: IterationCoverage[],
  nextItem: IterationCoverage
): IterationCoverage[] {
  const filtered = coverage.filter(
    (item) =>
      !(
        item.dimensionId === nextItem.dimensionId &&
        item.iteration === nextItem.iteration
      )
  );

  return [...filtered, nextItem].sort((a, b) => {
    if (a.dimensionId !== b.dimensionId) {
      return dimensionOrder(a.dimensionId) - dimensionOrder(b.dimensionId);
    }
    return a.iteration - b.iteration;
  });
}

function updateObjectsCoveredInIteration(
  objects: InvestigationObject[],
  selectedObjectIds: string[],
  iteration: IterationNumber
): InvestigationObject[] {
  const targetIds = new Set(selectedObjectIds);

  return objects.map((object) => {
    if (!targetIds.has(object.id)) return object;

    const coveredInIterations = uniqueStrings(
      [...(object.coveredInIterations ?? []).map(String), String(iteration)]
    )
      .map((value) => Number(value))
      .filter((value): value is IterationNumber => value === 1 || value === 2 || value === 3);

    return {
      ...object,
      coveredInIterations,
      status:
        iteration === 3
          ? "sufficiently_explored"
          : object.status === "new"
          ? "in_progress"
          : object.status,
    };
  });
}

function buildWeakMatterMode(
  objects: InvestigationObject[],
  dimensionId: DimensionId
): boolean {
  const dimensionObjects = objects.filter((item) => item.dimensionId === dimensionId);
  const strongOrMedium = dimensionObjects.filter(
    (item) => item.evidenceStrength === "strong" || item.evidenceStrength === "medium"
  ).length;

  return strongOrMedium < DIAGNOSTIC_PROTOCOL.nominalIterationRules[0].minimumCount;
}

function summarizeIterationFromBatch(
  batch: QuestionBatch,
  answers: DriverAnswer[],
  selectedObjects: InvestigationObject[]
): string {
  const answerCount = answers.filter(
    (answer) =>
      answer.dimensionId === batch.dimensionId &&
      answer.iteration === batch.iteration
  ).length;

  const objectLabels = selectedObjects.map((item) => item.label).slice(0, 3);

  return compactSummary(
    `Itération ${batch.iteration} sur la dimension ${batch.dimensionId} : ${answerCount} réponse(s) recueillie(s), autour de ${objectLabels.join(", ") || "plusieurs objets d’enquête"}.`
  );
}

function buildKeyFindings(
  objects: InvestigationObject[],
  signals: DiagnosticSignal[]
): string[] {
  const ranked = [...objects]
    .sort((a, b) => strongestEvidenceRank(b.evidenceStrength) - strongestEvidenceRank(a.evidenceStrength))
    .slice(0, 4);

  const findings = ranked.map((object) => {
    const supportingSignals = findSupportingSignals(signals, object);
    const support =
      supportingSignals[0]?.factAtomic ||
      object.supportSummary ||
      object.label;

    return compactSummary(
      `${object.label} : ${support}`
    );
  });

  return uniqueStrings(findings).slice(0, 4);
}

function buildNonPilotedAreas(
  objects: InvestigationObject[],
  signals: DiagnosticSignal[]
): string[] {
  const candidates = objects.filter((object) => {
    const text = normalizeKey(
      [object.label, object.supportSummary, ...(object.explorationAxes ?? [])].join(" ")
    );

    if (text.includes("non formal")) return true;
    if (text.includes("absence")) return true;
    if (text.includes("pilot")) return true;
    if (text.includes("anticip")) return true;
    if (text.includes("rituel")) return true;
    if (text.includes("cadre")) return true;

    const supporting = findSupportingSignals(signals, object);
    return supporting.some((signal) => normalizeKey(signal.factType).includes("lack"));
  });

  const areas = candidates.map((object) =>
    compactSummary(
      `Zone à sécuriser : ${object.label}. ${object.supportSummary || "Le pilotage reste insuffisamment étayé ou formalisé."}`
    )
  );

  return uniqueStrings(areas).slice(0, 3);
}

function freezeDimensionFromState(
  state: DiagnosticSessionEngineState,
  dimensionId: DimensionId,
  validationNote?: string
): FrozenDimensionSnapshot {
  const dimensionBatches = cloneArray(state.validationHistory)
    .filter((item) => item.dimensionId === dimensionId && item.decision === "validate")
    .map((item) => item.iteration);

  const iterationSummaries: FrozenIterationSummary[] = uniqueStrings(
    dimensionBatches.map(String)
  )
    .map((value) => Number(value))
    .filter((value): value is IterationNumber => value === 1 || value === 2 || value === 3)
    .sort((a, b) => a - b)
    .map((iteration) => {
      const batch = state.questions.filter(
        (question) =>
          question.dimensionId === dimensionId && question.iteration === iteration
      );

      const selectedObjectIds = uniqueStrings(batch.map((question) => question.objectId));
      const selectedObjects = state.investigationObjects.filter((object) =>
        selectedObjectIds.includes(object.id)
      );

      return {
        iteration,
        questionIds: batch.map((question) => question.id),
        exploredObjectIds: selectedObjectIds,
        summary: summarizeIterationFromBatch(
          {
            dimensionId,
            iteration,
            questions: batch,
          },
          state.answers,
          selectedObjects
        ),
      };
    });

  const retainedObjects = state.investigationObjects.filter(
    (object) =>
      object.dimensionId === dimensionId &&
      ((object.coveredInIterations ?? []).length > 0 ||
        object.status === "in_progress" ||
        object.status === "sufficiently_explored" ||
        object.status === "closed")
  );

  const salientSignals = retainedObjects.flatMap((object) => object.supportingSignalIds);

  return {
    dimensionId,
    frozenAt: nowIso(),
    iterationSummaries,
    salientSignalIds: uniqueStrings(salientSignals),
    retainedObjectIds: retainedObjects.map((object) => object.id),
    keyFindings: buildKeyFindings(
      retainedObjects,
      state.signals
    ),
    nonPilotedAreas: buildNonPilotedAreas(
      retainedObjects,
      state.signals
    ),
    driverValidationNote: normalizeText(validationNote) || undefined,
  };
}

function requireActiveIterationState(
  state: DiagnosticSessionEngineState
): ActiveIterationState {
  if (!state.currentIterationState) {
    throw new Error("Aucune itération active n'est disponible.");
  }

  return state.currentIterationState;
}

function requireCurrentBatch(
  state: DiagnosticSessionEngineState
): QuestionBatch {
  if (!state.currentBatch) {
    throw new Error("Aucun batch de questions actif n'est disponible.");
  }

  return state.currentBatch;
}

function buildIterationClosureMessage(
  dimensionId: DimensionId,
  iteration: IterationNumber
): string {
  const dimension = getDimensionDefinition(dimensionId);

  if (iteration === 1) {
    return `Merci. Souhaitez-vous valider l’itération 1 de la dimension "${dimension.label}" ou la rouvrir pour compléter le cadrage ?`;
  }

  if (iteration === 2) {
    return `Merci. Souhaitez-vous valider l’itération 2 de la dimension "${dimension.label}" ou la rouvrir pour compléter les mécanismes et arbitrages ?`;
  }

  return `Merci. Souhaitez-vous valider l’itération 3 de la dimension "${dimension.label}" ou la rouvrir pour compléter ce qui reste insuffisamment piloté ou formalisé ?`;
}

function buildIterationHeader(
  dimensionId: DimensionId,
  iteration: IterationNumber
): string {
  const dimension = getDimensionDefinition(dimensionId);
  return `Dimension : ${dimension.label} — itération ${iteration}/3`;
}

export function bootstrapSession(params: {
  sessionId: string;
  registry: SignalRegistry;
}): DiagnosticSessionEngineState {
  const state = createEmptyEngineState(params.sessionId);
  const firstDimensionId = DIMENSION_SEQUENCE[0] ?? null;

  if (!firstDimensionId) {
    return touchState(state);
  }

  const batch = buildQuestionBatch({
    state: {
      ...state,
      signals: params.registry.signals,
      investigationObjects: params.registry.investigationObjects,
    },
    dimensionId: firstDimensionId,
    iteration: 1,
  });

  const activeIterationState: ActiveIterationState = {
    dimensionId: firstDimensionId,
    iteration: 1,
    selectedObjectIds: batch.questions.map((question) => question.objectId),
    questionBatch: batch,
    openedAt: nowIso(),
    validationStatus: "in_progress",
  };

  return touchState({
    ...state,
    phase: "dimension_iteration",
    signals: cloneArray(params.registry.signals),
    investigationObjects: cloneArray(params.registry.investigationObjects),
    currentDimensionId: firstDimensionId,
    currentIteration: 1,
    currentBatch: batch,
    currentIterationState: activeIterationState,
    questions: cloneArray(batch.questions),
  });
}

export function getEngineView(
  state: DiagnosticSessionEngineState
): EngineView {
  if (state.phase === "awaiting_trame") {
    return {
      assistantMessage: "Le diagnostic ne peut pas démarrer sans matière d’entrée structurée.",
      questions: [],
      needsValidation: false,
      phase: state.phase,
      currentDimensionId: null,
      currentIteration: null,
    };
  }

  if (state.phase === "iteration_validation" && state.currentIterationState) {
    return {
      assistantMessage: `${buildIterationHeader(
        state.currentIterationState.dimensionId,
        state.currentIterationState.iteration
      )}\n\n${buildIterationClosureMessage(
        state.currentIterationState.dimensionId,
        state.currentIterationState.iteration
      )}`,
      questions: [],
      needsValidation: true,
      phase: state.phase,
      currentDimensionId: state.currentIterationState.dimensionId,
      currentIteration: state.currentIterationState.iteration,
    };
  }

  if (state.phase === "final_review") {
    return {
      assistantMessage:
        "Les 4 dimensions ont été parcourues et gelées. La session est prête pour la revue finale avant restitution.",
      questions: [],
      needsValidation: false,
      phase: state.phase,
      currentDimensionId: null,
      currentIteration: null,
    };
  }

  if (state.phase === "report_ready") {
    return {
      assistantMessage:
        "Le diagnostic est prêt pour l’aval de restitution.",
      questions: [],
      needsValidation: false,
      phase: state.phase,
      currentDimensionId: null,
      currentIteration: null,
    };
  }

  const batch = state.currentBatch;

  if (!batch) {
    return {
      assistantMessage: "Aucun batch de questions actif n’a été trouvé.",
      questions: [],
      needsValidation: false,
      phase: state.phase,
      currentDimensionId: state.currentDimensionId,
      currentIteration: state.currentIteration,
    };
  }

  return {
    assistantMessage: buildIterationHeader(batch.dimensionId, batch.iteration),
    questions: batch.questions,
    needsValidation: false,
    phase: state.phase,
    currentDimensionId: batch.dimensionId,
    currentIteration: batch.iteration,
  };
}

export function registerAnswer(params: {
  state: DiagnosticSessionEngineState;
  questionId: string;
  answerText: string;
}): DiagnosticSessionEngineState {
  const { state, questionId } = params;
  const answerText = normalizeText(params.answerText);

  if (state.phase !== "dimension_iteration") {
    throw new Error("La session n’est pas en phase de questions.");
  }

  const batch = requireCurrentBatch(state);
  const activeIterationState = requireActiveIterationState(state);

  const question = batch.questions.find((item) => item.id === questionId);
  if (!question) {
    throw new Error(`Question introuvable : ${questionId}`);
  }

  const alreadyAnswered = state.answers.some((item) => item.questionId === questionId);
  if (alreadyAnswered) {
    throw new Error(`La question ${questionId} a déjà une réponse.`);
  }

  const nextAnswer: DriverAnswer = {
    questionId,
    dimensionId: question.dimensionId,
    iteration: question.iteration,
    answerText,
  };

  const nextAnswers = [...state.answers, nextAnswer];
  const weakMatterMode = buildWeakMatterMode(
    state.investigationObjects,
    batch.dimensionId
  );

  const actualCount = nextAnswers.filter(
    (item) =>
      item.dimensionId === batch.dimensionId &&
      item.iteration === batch.iteration
  ).length;

  const nextCoverageItem = buildIterationCoverage({
    dimensionId: batch.dimensionId,
    iteration: batch.iteration,
    actualCount,
    weakMatterMode,
  });

  const nextCoverage = mergeCoverage(state.coverage, nextCoverageItem);
  const minimumReached = isCoverageSufficient(nextCoverageItem);

  const nextState: DiagnosticSessionEngineState = {
    ...state,
    answers: nextAnswers,
    coverage: nextCoverage,
    currentIterationState: {
      ...activeIterationState,
      validationStatus: minimumReached ? "awaiting_validation" : "in_progress",
      closureRequestedAt: minimumReached ? nowIso() : activeIterationState.closureRequestedAt,
    },
    phase: minimumReached ? "iteration_validation" : "dimension_iteration",
  };

  return touchState(nextState);
}

export function submitIterationValidation(params: {
  state: DiagnosticSessionEngineState;
  decision: IterationValidationDecision;
  note?: string;
}): DiagnosticSessionEngineState {
  let state = params.state;

  if (state.phase !== "iteration_validation") {
    throw new Error("La session n’attend pas de validation d’itération.");
  }

  const activeIterationState = requireActiveIterationState(state);
  const batch = requireCurrentBatch(state);

  const nextValidationTrace: IterationValidationTrace = {
    dimensionId: activeIterationState.dimensionId,
    iteration: activeIterationState.iteration,
    decision: params.decision,
    note: normalizeText(params.note) || undefined,
    decidedAt: nowIso(),
  };

  if (params.decision === "reopen") {
    const reopenedBatch = buildQuestionBatch({
      state,
      dimensionId: activeIterationState.dimensionId,
      iteration: activeIterationState.iteration,
    });

    return touchState({
      ...state,
      phase: "dimension_iteration",
      currentBatch: reopenedBatch,
      currentIterationState: {
        ...activeIterationState,
        questionBatch: reopenedBatch,
        selectedObjectIds: reopenedBatch.questions.map((question) => question.objectId),
        validationStatus: "in_progress",
        closureRequestedAt: undefined,
      },
      validationHistory: [...state.validationHistory, nextValidationTrace],
      questions: uniqueQuestions([
        ...state.questions,
        ...reopenedBatch.questions,
      ]),
    });
  }

  const updatedObjects = updateObjectsCoveredInIteration(
    state.investigationObjects,
    activeIterationState.selectedObjectIds,
    activeIterationState.iteration
  );

  state = {
    ...state,
    investigationObjects: updatedObjects,
    validationHistory: [...state.validationHistory, nextValidationTrace],
    currentIterationState: {
      ...activeIterationState,
      validatedAt: nowIso(),
      validationStatus: "validated",
    },
  };

  if (!isLastIteration(activeIterationState.iteration)) {
    const nextIteration = nextIterationNumber(activeIterationState.iteration);
    if (!nextIteration) {
      throw new Error("Impossible de déterminer l’itération suivante.");
    }

    const nextBatch = buildQuestionBatch({
      state,
      dimensionId: activeIterationState.dimensionId,
      iteration: nextIteration,
    });

    return touchState({
      ...state,
      phase: "dimension_iteration",
      currentIteration: nextIteration,
      currentBatch: nextBatch,
      currentIterationState: {
        dimensionId: activeIterationState.dimensionId,
        iteration: nextIteration,
        selectedObjectIds: nextBatch.questions.map((question) => question.objectId),
        questionBatch: nextBatch,
        openedAt: nowIso(),
        validationStatus: "in_progress",
      },
      questions: uniqueQuestions([...state.questions, ...nextBatch.questions]),
    });
  }

  const frozenDimension = freezeDimensionFromState(
    state,
    activeIterationState.dimensionId,
    params.note
  );

  const nextFrozenDimensions = [
    ...state.frozenDimensions.filter(
      (item) => item.dimensionId !== activeIterationState.dimensionId
    ),
    frozenDimension,
  ].sort((a, b) => dimensionOrder(a.dimensionId) - dimensionOrder(b.dimensionId));

  if (!isLastDimension(activeIterationState.dimensionId)) {
    const upcomingDimension = nextDimensionId(activeIterationState.dimensionId);
    if (!upcomingDimension) {
      throw new Error("Impossible de déterminer la dimension suivante.");
    }

    const nextBatch = buildQuestionBatch({
      state: {
        ...state,
        frozenDimensions: nextFrozenDimensions,
      },
      dimensionId: upcomingDimension,
      iteration: 1,
    });

    return touchState({
      ...state,
      phase: "dimension_iteration",
      frozenDimensions: nextFrozenDimensions,
      currentDimensionId: upcomingDimension,
      currentIteration: 1,
      currentBatch: nextBatch,
      currentIterationState: {
        dimensionId: upcomingDimension,
        iteration: 1,
        selectedObjectIds: nextBatch.questions.map((question) => question.objectId),
        questionBatch: nextBatch,
        openedAt: nowIso(),
        validationStatus: "in_progress",
      },
      questions: uniqueQuestions([...state.questions, ...nextBatch.questions]),
    });
  }

  return touchState({
    ...state,
    phase: "final_review",
    frozenDimensions: nextFrozenDimensions,
    currentDimensionId: null,
    currentIteration: null,
    currentBatch: null,
    currentIterationState: null,
  });
}

export function markReportReady(
  state: DiagnosticSessionEngineState
): DiagnosticSessionEngineState {
  return touchState({
    ...state,
    phase: "report_ready",
  });
}

export function cloneSessionState(
  state: DiagnosticSessionEngineState
): DiagnosticSessionEngineState {
  return {
    ...state,
    signals: cloneArray(state.signals),
    investigationObjects: cloneArray(state.investigationObjects),
    questions: cloneArray(state.questions),
    answers: cloneArray(state.answers),
    coverage: cloneArray(state.coverage),
    frozenDimensions: cloneArray(state.frozenDimensions),
    validationHistory: cloneArray(state.validationHistory),
    currentBatch: state.currentBatch
      ? {
          ...state.currentBatch,
          questions: cloneArray(state.currentBatch.questions),
        }
      : null,
    currentIterationState: state.currentIterationState
      ? {
          ...state.currentIterationState,
          selectedObjectIds: cloneArray(state.currentIterationState.selectedObjectIds),
          questionBatch: {
            ...state.currentIterationState.questionBatch,
            questions: cloneArray(state.currentIterationState.questionBatch.questions),
          },
        }
      : null,
  };
}

export function answeredCount(
  state: DiagnosticSessionEngineState
): number {
  const activeIterationState = state.currentIterationState;
  if (!activeIterationState) return 0;

  return state.answers.filter(
    (answer) =>
      answer.dimensionId === activeIterationState.dimensionId &&
      answer.iteration === activeIterationState.iteration
  ).length;
}

export function answeredQuestionIdSet(
  state: DiagnosticSessionEngineState
): Set<string> {
  const activeIterationState = state.currentIterationState;
  if (!activeIterationState) return new Set<string>();

  const questionIds = state.answers
    .filter(
      (answer) =>
        answer.dimensionId === activeIterationState.dimensionId &&
        answer.iteration === activeIterationState.iteration
    )
    .map((answer) => answer.questionId);

  return new Set(questionIds);
}

function uniqueQuestions(items: StructuredQuestion[]): StructuredQuestion[] {
  const seen = new Set<string>();
  const out: StructuredQuestion[] = [];

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }

  return out;
}