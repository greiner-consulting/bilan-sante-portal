// lib/bilan-sante/protocol-engine.ts

import {
  FINAL_OBJECTIVES_HEADER,
  buildIterationClosurePrompt,
  buildIterationHeader,
  dimensionKey,
  dimensionTitle,
  getDimensionDefinition,
  isLastDimension,
  isLastIteration,
  minQuestionsForIteration,
  nextDimensionId,
  nextIterationNumber,
  type DimensionId,
  type IterationNumber,
  type ValidationDecision,
} from "@/lib/bilan-sante/protocol";
import {
  answeredQuestionIds,
  cloneRegistry,
  cloneWorkset,
  createEmptySessionAggregate,
  isWorksetFullyAnswered,
  touchSession,
  type AnswerRecord,
  type DiagnosticSessionAggregate,
  type DiagnosticSignal,
  type FinalObjective,
  type FinalObjectiveSet,
  type FrozenDimensionDiagnosis,
  type IterationWorkset,
  type StructuredQuestion,
  type ZoneNonPilotee,
} from "@/lib/bilan-sante/session-model";
import { buildSignalRegistry } from "@/lib/bilan-sante/signal-extractor";
import { readBaseTrame } from "@/lib/bilan-sante/trame-reader";

export interface EngineView {
  assistantMessage: string;
  questions: StructuredQuestion[];
  needsValidation: boolean;
  phase: DiagnosticSessionAggregate["phase"];
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

function buildOpenQuestionFromSignal(
  signal: DiagnosticSignal,
  iteration: IterationNumber
): string {
  switch (iteration) {
    case 1:
      return `Concrètement, comment ce sujet se passe-t-il aujourd’hui dans le fonctionnement réel de l’entreprise sur le thème "${signal.theme}" ?`;
    case 2:
      return `Qu’est-ce qui explique surtout cette situation aujourd’hui, et quels arbitrages ou dépendances la maintiennent sur le thème "${signal.theme}" ?`;
    case 3:
      return `Au regard de ce point, qu’est-ce qui reste non piloté ou insuffisamment formalisé aujourd’hui sur le thème "${signal.theme}" ?`;
    default:
      return `Pouvez-vous préciser ce point sur le thème "${signal.theme}" ?`;
  }
}

function buildQuestion(signal: DiagnosticSignal, iteration: IterationNumber, index: number): StructuredQuestion {
  return {
    id: `q-${signal.id}-it${iteration}-${index}`,
    signalId: signal.id,
    theme: signal.theme,
    constat: signal.constat,
    risqueManagerial: signal.managerialRisk,
    questionOuverte: buildOpenQuestionFromSignal(signal, iteration),
  };
}

function selectSignalsForIteration(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  iteration: IterationNumber,
  count: number
): DiagnosticSignal[] {
  const registry = session.signalRegistry;
  if (!registry) return [];

  const pool = [...registry.byDimension[dimensionKey(dimensionId)]];
  const frozen = session.frozenDimensions.find((d) => d.dimensionId === dimensionId);
  if (frozen) return [];

  const biasByIteration = (signal: DiagnosticSignal): number => {
    let score = signal.criticalityScore * 2 + signal.confidenceScore;

    if (iteration === 1) {
      if (signal.signalKind === "explicit") score += 30;
      if (signal.entryAngle === "mechanism" || signal.entryAngle === "formalization") score += 20;
    }

    if (iteration === 2) {
      if (signal.entryAngle === "causality" || signal.entryAngle === "arbitration") score += 25;
      if (signal.entryAngle === "dependency") score += 18;
    }

    if (iteration === 3) {
      if (signal.signalKind === "absence") score += 35;
      if (signal.entryAngle === "formalization" || signal.entryAngle === "economics") score += 20;
    }

    return score;
  };

  return pool.sort((a, b) => biasByIteration(b) - biasByIteration(a)).slice(0, count);
}

function buildWorkset(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  iteration: IterationNumber,
  reopen = false
): IterationWorkset {
  const minQuestions = reopen ? 3 : minQuestionsForIteration(iteration);
  const selectedSignals = selectSignalsForIteration(session, dimensionId, iteration, minQuestions);

  const questions = uniqueById(
    selectedSignals.map((signal, idx) => buildQuestion(signal, iteration, idx + 1))
  ).slice(0, minQuestions);

  return {
    dimensionId,
    iteration,
    header: buildIterationHeader(dimensionId, iteration),
    questions,
    answers: [],
    closurePrompt: buildIterationClosurePrompt(dimensionId, iteration),
  };
}

function conservativeScoreFromSignals(signals: DiagnosticSignal[]): 1 | 2 | 3 | 4 | 5 {
  if (signals.length === 0) return 2;

  const avgCriticality =
    signals.reduce((sum, item) => sum + item.criticalityScore, 0) / signals.length;
  const absenceRatio =
    signals.filter((item) => item.signalKind === "absence").length / signals.length;

  const raw = 5 - Math.round((avgCriticality / 100) * 2 + absenceRatio * 2);
  const clamped = Math.max(1, Math.min(5, raw));

  return clamped as 1 | 2 | 3 | 4 | 5;
}

function deriveRootCause(signals: DiagnosticSignal[]): string {
  const text = signals
    .map((s) => `${s.theme} ${s.managerialRisk} ${s.probableConsequence}`)
    .join(" ")
    .toLowerCase();

  if (text.includes("non document") || text.includes("non suivi") || text.includes("formalis")) {
    return "Pilotage insuffisamment formalisé sur des sujets structurants.";
  }

  if (text.includes("arbitrage") || text.includes("décide") || text.includes("validation")) {
    return "Chaîne d’arbitrage insuffisamment clarifiée ou trop centralisée.";
  }

  if (text.includes("dépend") || text.includes("clé") || text.includes("quelques personnes")) {
    return "Dépendance excessive à des personnes ou relais clés.";
  }

  if (text.includes("marge") || text.includes("cash") || text.includes("rentabilité")) {
    return "Pilotage économique insuffisamment relié aux décisions opérationnelles ou commerciales.";
  }

  return "Écarts entre fonctionnement réel, responsabilités tenues et cadre de pilotage attendu.";
}

function buildConsolidatedFindings(signals: DiagnosticSignal[]): [string, string, string] {
  const top = [...signals]
    .sort((a, b) => b.criticalityScore - a.criticalityScore)
    .slice(0, 3);

  const findings = top.map(
    (signal) =>
      `${signal.theme} — ${signal.constat.replace(/\.$/, "")}. Conséquence probable : ${signal.probableConsequence.replace(/\.$/, "")}.`
  );

  while (findings.length < 3) {
    findings.push(
      "Un ensemble de sujets reste partiellement documenté, ce qui limite la robustesse du diagnostic et révèle une zone de pilotage à sécuriser."
    );
  }

  return [findings[0], findings[1], findings[2]];
}

function buildUnmanagedZones(signals: DiagnosticSignal[]): ZoneNonPilotee[] {
  const selected = [...signals]
    .filter((s) => s.signalKind === "absence" || s.criticalityScore >= 80)
    .sort((a, b) => b.criticalityScore - a.criticalityScore)
    .slice(0, 3);

  if (selected.length === 0) {
    return [
      {
        constat:
          "Peu de zones non pilotées massives ressortent, mais plusieurs sujets restent dépendants d’usages plus que d’un cadre structuré.",
        risqueManagerial:
          "Risque de dérive progressive sans signal faible suffisamment remonté.",
        consequence:
          "Dégradation lente de la tenue des engagements, de la coordination ou de la visibilité économique.",
      },
    ];
  }

  return selected.map((signal) => ({
    constat: signal.constat,
    risqueManagerial: signal.managerialRisk,
    consequence: signal.probableConsequence,
  }));
}

function freezeDimension(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): FrozenDimensionDiagnosis {
  const signals = session.signalRegistry?.byDimension[dimensionKey(dimensionId)] ?? [];

  return {
    dimensionId,
    score: conservativeScoreFromSignals(signals),
    consolidatedFindings: buildConsolidatedFindings(signals),
    dominantRootCause: deriveRootCause(signals),
    unmanagedZones: buildUnmanagedZones(signals),
    frozenAt: new Date().toISOString(),
  };
}

function buildObjectiveFromFrozenDimension(
  frozen: FrozenDimensionDiagnosis,
  index: number
): FinalObjective {
  const dimensionName = dimensionTitle(frozen.dimensionId);
  const mainZone = frozen.unmanagedZones[0];

  return {
    id: `obj-d${frozen.dimensionId}-${index}`,
    dimensionId: frozen.dimensionId,
    objectiveLabel: `Réduire sous 6 mois l’exposition de la dimension "${dimensionName}" à la zone non pilotée dominante`,
    owner: "Dirigeant / responsable de dimension",
    keyIndicator: `Indicateur de maîtrise du thème critique de la dimension ${frozen.dimensionId}`,
    dueDate: "À définir avec le dirigeant",
    potentialGain:
      "Fourchette prudente à estimer lors de l’itération finale selon données disponibles",
    gainHypotheses: [
      "Aucun chiffre précis n’est inventé.",
      "La fourchette devra être reliée à la conséquence économique probable identifiée.",
      `Point de départ : ${mainZone?.consequence ?? "conséquence à préciser en validation dirigeant"}`,
    ],
    validationStatus: "proposed",
    quickWin: `Sécuriser en premier le point : ${mainZone?.constat ?? frozen.consolidatedFindings[0]}`,
  };
}

function buildFinalObjectiveSet(session: DiagnosticSessionAggregate): FinalObjectiveSet {
  const objectives = session.frozenDimensions
    .slice(0, 5)
    .map((frozen, idx) => buildObjectiveFromFrozenDimension(frozen, idx + 1));

  return {
    header: FINAL_OBJECTIVES_HEADER,
    objectives,
  };
}

function requireCurrentWorkset(session: DiagnosticSessionAggregate): IterationWorkset {
  if (!session.currentWorkset) {
    throw new Error("Aucune itération active dans la session.");
  }
  return session.currentWorkset;
}

export function bootstrapSessionFromTrame(params: {
  sessionId: string;
  rawTrameText: string;
}): DiagnosticSessionAggregate {
  const trame = readBaseTrame(params.rawTrameText);
  const signalRegistry = buildSignalRegistry(trame);

  let session = createEmptySessionAggregate(params.sessionId);
  session = {
    ...session,
    phase: "dimension_iteration",
    trame,
    signalRegistry,
    currentDimensionId: 1,
    currentIteration: 1,
  };

  session.currentWorkset = buildWorkset(session, 1, 1, false);

  return touchSession(session);
}

export function getEngineView(session: DiagnosticSessionAggregate): EngineView {
  if (session.phase === "awaiting_trame") {
    return {
      assistantMessage:
        "Le diagnostic ne peut pas démarrer sans trame de base exploitée.",
      questions: [],
      needsValidation: false,
      phase: session.phase,
      currentDimensionId: null,
      currentIteration: null,
    };
  }

  if (session.phase === "final_objectives_validation") {
    const objectives = session.finalObjectives?.objectives ?? [];
    const lines = objectives.map(
      (objective, index) =>
        `${index + 1}. ${objective.objectiveLabel} — ${objective.keyIndicator}`
    );

    return {
      assistantMessage: `${FINAL_OBJECTIVES_HEADER}\n\nObjectifs proposés :\n${lines.join(
        "\n"
      )}\n\nMerci d’indiquer pour chaque objectif : Validé / Ajusté / Refusé.`,
      questions: [],
      needsValidation: true,
      phase: session.phase,
      currentDimensionId: null,
      currentIteration: null,
    };
  }

  if (session.phase === "report_ready") {
    return {
      assistantMessage:
        "Le diagnostic est séquencé, les 4 dimensions sont gelées et l’itération finale objectifs est capturée. La session est prête pour le report builder standardisé.",
      questions: [],
      needsValidation: false,
      phase: session.phase,
      currentDimensionId: null,
      currentIteration: null,
    };
  }

  const workset = session.currentWorkset;

  if (!workset) {
    return {
      assistantMessage: "Aucune itération active trouvée.",
      questions: [],
      needsValidation: false,
      phase: session.phase,
      currentDimensionId: session.currentDimensionId,
      currentIteration: session.currentIteration,
    };
  }

  if (session.phase === "iteration_validation") {
    return {
      assistantMessage: `${workset.header}\n\n${workset.closurePrompt}`,
      questions: [],
      needsValidation: true,
      phase: session.phase,
      currentDimensionId: workset.dimensionId,
      currentIteration: workset.iteration,
    };
  }

  return {
    assistantMessage: workset.header,
    questions: workset.questions,
    needsValidation: false,
    phase: session.phase,
    currentDimensionId: workset.dimensionId,
    currentIteration: workset.iteration,
  };
}

export function registerAnswer(params: {
  session: DiagnosticSessionAggregate;
  questionId: string;
  answerText: string;
}): DiagnosticSessionAggregate {
  const { session, questionId, answerText } = params;

  if (session.phase !== "dimension_iteration") {
    throw new Error("La session n’est pas en phase de questions.");
  }

  const workset = requireCurrentWorkset(session);
  const question = workset.questions.find((q) => q.id === questionId);

  if (!question) {
    throw new Error(`Question introuvable: ${questionId}`);
  }

  const alreadyAnswered = workset.answers.some((a) => a.questionId === questionId);
  if (alreadyAnswered) {
    throw new Error(`La question ${questionId} a déjà reçu une réponse.`);
  }

  const nextAnswer: AnswerRecord = {
    questionId,
    answerText: String(answerText ?? "").trim(),
    answeredAt: new Date().toISOString(),
  };

  const nextWorkset: IterationWorkset = {
    ...workset,
    answers: [...workset.answers, nextAnswer],
  };

  const answeredCount = nextWorkset.answers.length;
  const minimum = minQuestionsForIteration(nextWorkset.iteration);

  let nextSession: DiagnosticSessionAggregate = {
    ...session,
    currentWorkset: nextWorkset,
  };

  if (answeredCount >= minimum && isWorksetFullyAnswered(nextWorkset)) {
    nextSession.phase = "iteration_validation";
    nextWorkset.closureAskedAt = new Date().toISOString();
  }

  return touchSession(nextSession);
}

export function submitIterationClosure(params: {
  session: DiagnosticSessionAggregate;
  decision: ValidationDecision;
}): DiagnosticSessionAggregate {
  let session = params.session;

  if (session.phase !== "iteration_validation") {
    throw new Error("La session n’attend pas de validation d’itération.");
  }

  const currentWorkset = requireCurrentWorkset(session);

  if (params.decision === "no") {
    session = {
      ...session,
      phase: "dimension_iteration",
      currentWorkset: buildWorkset(
        session,
        currentWorkset.dimensionId,
        currentWorkset.iteration,
        true
      ),
    };

    return touchSession(session);
  }

  if (!isLastIteration(currentWorkset.iteration)) {
    const nextIteration = nextIterationNumber(currentWorkset.iteration)!;

    session = {
      ...session,
      phase: "dimension_iteration",
      currentIteration: nextIteration,
      currentWorkset: buildWorkset(session, currentWorkset.dimensionId, nextIteration, false),
    };

    return touchSession(session);
  }

  const frozen = freezeDimension(session, currentWorkset.dimensionId);
  const existing = session.frozenDimensions.filter(
    (item) => item.dimensionId !== currentWorkset.dimensionId
  );

  session = {
    ...session,
    frozenDimensions: [...existing, frozen].sort((a, b) => a.dimensionId - b.dimensionId),
  };

  if (!isLastDimension(currentWorkset.dimensionId)) {
    const nextDimension = nextDimensionId(currentWorkset.dimensionId)!;

    session = {
      ...session,
      phase: "dimension_iteration",
      currentDimensionId: nextDimension,
      currentIteration: 1,
      currentWorkset: buildWorkset(session, nextDimension, 1, false),
    };

    return touchSession(session);
  }

  const finalObjectives = buildFinalObjectiveSet(session);

  session = {
    ...session,
    phase: "final_objectives_validation",
    currentDimensionId: null,
    currentIteration: null,
    currentWorkset: null,
    finalObjectives,
  };

  return touchSession(session);
}

export function captureObjectivesValidation(params: {
  session: DiagnosticSessionAggregate;
  decisions: Array<{
    objectiveId: string;
    status: "validated" | "adjusted" | "refused";
    adjustedLabel?: string;
    adjustedIndicator?: string;
    adjustedDueDate?: string;
  }>;
}): DiagnosticSessionAggregate {
  const { session, decisions } = params;

  if (session.phase !== "final_objectives_validation" || !session.finalObjectives) {
    throw new Error("La session n’est pas en phase finale de validation des objectifs.");
  }

  const decisionsById = new Map(decisions.map((d) => [d.objectiveId, d]));

  const nextObjectives = session.finalObjectives.objectives.map((objective) => {
    const decision = decisionsById.get(objective.id);
    if (!decision) return objective;

    return {
      ...objective,
      objectiveLabel:
        decision.status === "adjusted" && decision.adjustedLabel
          ? decision.adjustedLabel
          : objective.objectiveLabel,
      keyIndicator:
        decision.status === "adjusted" && decision.adjustedIndicator
          ? decision.adjustedIndicator
          : objective.keyIndicator,
      dueDate:
        decision.status === "adjusted" && decision.adjustedDueDate
          ? decision.adjustedDueDate
          : objective.dueDate,
      validationStatus: decision.status,
    };
  });

  const nextSession: DiagnosticSessionAggregate = {
    ...session,
    phase: "report_ready",
    finalObjectives: {
      ...session.finalObjectives,
      objectives: nextObjectives,
      decisionsCapturedAt: new Date().toISOString(),
    },
  };

  return touchSession(nextSession);
}

export function cloneSession(session: DiagnosticSessionAggregate): DiagnosticSessionAggregate {
  return {
    ...session,
    signalRegistry: session.signalRegistry ? cloneRegistry(session.signalRegistry) : null,
    currentWorkset: cloneWorkset(session.currentWorkset),
    frozenDimensions: [...session.frozenDimensions],
    finalObjectives: session.finalObjectives
      ? {
          ...session.finalObjectives,
          objectives: [...session.finalObjectives.objectives],
        }
      : null,
  };
}

export function answeredCount(session: DiagnosticSessionAggregate): number {
  return session.currentWorkset?.answers.length ?? 0;
}

export function answeredQuestionIdSet(session: DiagnosticSessionAggregate): Set<string> {
  return answeredQuestionIds(session.currentWorkset);
}