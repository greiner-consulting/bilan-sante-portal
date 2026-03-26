// lib/bilan-sante/protocol-engine.ts

import {
  FINAL_OBJECTIVES_HEADER,
  buildIterationClosurePrompt,
  buildIterationHeader,
  dimensionKey,
  dimensionTitle,
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
  type EntryAngle,
  type FinalObjective,
  type FinalObjectiveSet,
  type FrozenDimensionDiagnosis,
  type IterationWorkset,
  type MemoryInsight,
  type StructuredQuestion,
  type ZoneNonPilotee,
} from "@/lib/bilan-sante/session-model";
import { planIterationQuestions } from "@/lib/bilan-sante/question-planner";
import {
  buildSignalRegistry,
  buildSignalRegistryWithLlm,
} from "@/lib/bilan-sante/signal-extractor";
import { readBaseTrame } from "@/lib/bilan-sante/trame-reader";
import {
  analyzeUserAnswer,
  buildRephrasedQuestionFromAnalysis,
} from "@/lib/bilan-sante/answer-analyzer";

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

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: string | null | undefined): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function shortenText(value: string | null | undefined, max = 220): string {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function withSafeMemory(
  session: DiagnosticSessionAggregate
): DiagnosticSessionAggregate {
  return {
    ...session,
    analysisMemory: session.analysisMemory ?? [],
  };
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

function getDimensionSignals(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): DiagnosticSignal[] {
  const registry = session.signalRegistry;
  if (!registry) return [];

  return registry.byDimension[dimensionKey(dimensionId)] ?? [];
}

function findSignalById(
  session: DiagnosticSessionAggregate,
  signalId: string
): DiagnosticSignal | undefined {
  return getAllSignals(session).find((signal) => signal.id === signalId);
}

function getCurrentUnansweredQuestion(
  workset: IterationWorkset | null | undefined
): StructuredQuestion | null {
  if (!workset) return null;

  const answeredIds = answeredQuestionIds(workset);
  return workset.questions.find((question) => !answeredIds.has(question.id)) ?? null;
}

function getMemoryForTheme(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId | null | undefined,
  theme: string | null | undefined
): MemoryInsight[] {
  const normalizedTheme = normalizeForMatch(theme);
  if (!normalizedTheme) return [];

  return (session.analysisMemory ?? []).filter((item) => {
    if (normalizeForMatch(item.theme) !== normalizedTheme) {
      return false;
    }

    if (dimensionId == null) {
      return true;
    }

    return item.dimensionId === dimensionId;
  });
}

function getLatestUsableThemeMemory(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId | null | undefined,
  theme: string | null | undefined
): MemoryInsight | null {
  const usable = getMemoryForTheme(session, dimensionId, theme).filter(
    (item) => item.isUsableBusinessMatter || item.shouldPivotAngle
  );

  return usable[usable.length - 1] ?? null;
}

function getDominantAngleFromThemeMemory(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId | null | undefined,
  theme: string | null | undefined
): EntryAngle | null {
  const memory = getMemoryForTheme(session, dimensionId, theme);

  const counts = new Map<EntryAngle, number>();

  for (const item of memory) {
    if (!item.suggestedAngle) continue;
    counts.set(item.suggestedAngle, (counts.get(item.suggestedAngle) ?? 0) + 1);
  }

  let bestAngle: EntryAngle | null = null;
  let bestScore = -1;

  for (const [angle, score] of counts.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }

  return bestAngle;
}

function buildMemoryAnchor(params: {
  session: DiagnosticSessionAggregate;
  dimensionId: DimensionId | null | undefined;
  theme: string | null | undefined;
}): string {
  const latest = getLatestUsableThemeMemory(
    params.session,
    params.dimensionId,
    params.theme
  );

  if (!latest) return "";

  const fact = latest.extractedFacts?.[0];
  if (!fact) return "";

  return ` Vous avez déjà indiqué notamment : "${shortenText(fact, 140)}".`;
}

function buildAngleSpecificRewrite(params: {
  session: DiagnosticSessionAggregate;
  dimensionId: DimensionId | null | undefined;
  theme: string;
  suggestedAngle: EntryAngle | null;
  iteration: IterationNumber | null | undefined;
}): string | null {
  const { session, dimensionId, theme, suggestedAngle, iteration } = params;
  const anchor = buildMemoryAnchor({ session, dimensionId, theme });

  if (suggestedAngle === "causality") {
    if (iteration === 1) {
      return `Restons sur "${theme}", mais repartons du bon angle : quel mécanisme concret produit la difficulté aujourd’hui, et qu’est-ce qui l’explique selon vous ?${anchor}`;
    }

    return `Restons sur "${theme}", mais repartons du bon angle : selon vous, la difficulté vient-elle surtout d’un manque de compétences, d’expérience, de décisions inadaptées ou d’une organisation mal posée ?${anchor}`;
  }

  if (suggestedAngle === "arbitration") {
    return `Sur "${theme}", qui décide réellement, qui valide, et à quel endroit la chaîne d’arbitrage ralentit ou déforme les décisions ?${anchor}`;
  }

  if (suggestedAngle === "economics") {
    return `Sur "${theme}", quel est l’impact économique concret du problème évoqué : marge, coût réel, trésorerie ou rentabilité ?${anchor}`;
  }

  if (suggestedAngle === "formalization") {
    return `Sur "${theme}", qu’est-ce qui relève surtout d’un défaut de cadre, de rôles, de méthode ou de pilotage formalisé ?${anchor}`;
  }

  if (suggestedAngle === "dependency") {
    return `Sur "${theme}", où se situe la dépendance la plus critique aujourd’hui : une personne clé, un validateur, une ressource rare ou un point de blocage structurel ?${anchor}`;
  }

  if (suggestedAngle === "mechanism") {
    return `Sur "${theme}", comment le problème se produit-il concrètement dans le fonctionnement réel : à quel moment, avec quels acteurs, et selon quel enchaînement ?${anchor}`;
  }

  return null;
}

function shouldRewriteFromAnalysis(
  intent: ReturnType<typeof analyzeUserAnswer>["intent"],
  shouldRephraseQuestion: boolean,
  shouldPivotAngle: boolean
): boolean {
  if (shouldRephraseQuestion || shouldPivotAngle) {
    return true;
  }

  if (intent === "challenge" || intent === "noise") {
    return true;
  }

  return false;
}

function buildQuestionOpenRewrite(params: {
  session: DiagnosticSessionAggregate;
  question: StructuredQuestion;
  rawMessage: string;
  dimensionId: DimensionId | null | undefined;
  iteration: IterationNumber | null | undefined;
}): string {
  const { session, question, rawMessage, dimensionId, iteration } = params;
  const signal = findSignalById(session, question.signalId);

  const analysis = analyzeUserAnswer({
    rawMessage,
    currentQuestion: {
      theme: question.theme,
      constat: question.constat,
      questionOuverte: question.questionOuverte,
      entryAngle: signal?.entryAngle ?? null,
    },
  });

  if (
    !shouldRewriteFromAnalysis(
      analysis.intent,
      analysis.shouldRephraseQuestion,
      analysis.shouldPivotAngle
    )
  ) {
    return question.questionOuverte;
  }

  const dominantMemoryAngle = getDominantAngleFromThemeMemory(
    session,
    dimensionId,
    question.theme
  );

  const suggestedAngle = analysis.suggestedAngle ?? dominantMemoryAngle;

  if (analysis.shouldPivotAngle && suggestedAngle) {
    const angleSpecific = buildAngleSpecificRewrite({
      session,
      dimensionId,
      theme: question.theme,
      suggestedAngle,
      iteration,
    });

    if (angleSpecific) {
      return angleSpecific;
    }
  }

  const rewritten = buildRephrasedQuestionFromAnalysis({
    analysis,
    currentQuestion: {
      theme: question.theme,
      constat: question.constat,
      questionOuverte: question.questionOuverte,
      entryAngle: suggestedAngle ?? signal?.entryAngle ?? null,
    },
  });

  const anchor = buildMemoryAnchor({
    session,
    dimensionId,
    theme: question.theme,
  });

  if (anchor && !normalizeText(rewritten).includes(normalizeText(anchor))) {
    return `${normalizeText(rewritten)}${anchor}`;
  }

  return normalizeText(rewritten) || question.questionOuverte;
}

function rewriteCurrentQuestionInSession(params: {
  session: DiagnosticSessionAggregate;
  rawMessage?: string;
}): DiagnosticSessionAggregate {
  const { session } = params;
  const rawMessage = normalizeText(params.rawMessage);

  if (!rawMessage) {
    return touchSession(withSafeMemory({ ...session }));
  }

  const workset = session.currentWorkset;
  const currentQuestion = getCurrentUnansweredQuestion(workset);

  if (!workset || !currentQuestion) {
    return touchSession(withSafeMemory({ ...session }));
  }

  const nextQuestionOuverte = buildQuestionOpenRewrite({
    session,
    question: currentQuestion,
    rawMessage,
    dimensionId: workset.dimensionId,
    iteration: workset.iteration,
  });

  if (nextQuestionOuverte === currentQuestion.questionOuverte) {
    return touchSession(withSafeMemory({ ...session }));
  }

  const nextQuestions = workset.questions.map((question) =>
    question.id === currentQuestion.id
      ? {
          ...question,
          questionOuverte: nextQuestionOuverte,
        }
      : question
  );

  return touchSession(
    withSafeMemory({
      ...session,
      currentWorkset: {
        ...workset,
        questions: nextQuestions,
      },
    })
  );
}

function previewChallengedQuestion(params: {
  session: DiagnosticSessionAggregate;
  rawMessage?: string;
}): StructuredQuestion | null {
  const { session } = params;
  const rawMessage = normalizeText(params.rawMessage);
  const workset = session.currentWorkset;
  const currentQuestion = getCurrentUnansweredQuestion(workset);

  if (!currentQuestion || !workset) {
    return null;
  }

  if (!rawMessage) {
    return currentQuestion;
  }

  const nextQuestionOuverte = buildQuestionOpenRewrite({
    session,
    question: currentQuestion,
    rawMessage,
    dimensionId: workset.dimensionId,
    iteration: workset.iteration,
  });

  return {
    ...currentQuestion,
    questionOuverte: nextQuestionOuverte,
  };
}

function buildOpenQuestionFromSignal(
  signal: DiagnosticSignal,
  iteration: IterationNumber
): string {
  const excerpt = shortenText(signal.sourceExcerpt, 220);

  switch (iteration) {
    case 1:
      if (signal.signalKind === "absence") {
        return `Sur le thème "${signal.theme}", la trame ne met pas en évidence de pilotage structuré. Comment ce sujet est-il réellement traité aujourd’hui dans l’entreprise ?`;
      }

      if (excerpt) {
        return `Sur le thème "${signal.theme}", la trame mentionne : "${excerpt}". Concrètement, comment ce sujet est-il géré aujourd’hui dans le fonctionnement réel de l’entreprise ?`;
      }

      return `Sur le thème "${signal.theme}", comment ce sujet est-il géré aujourd’hui dans le fonctionnement réel de l’entreprise ?`;

    case 2:
      return `Si l’on creuse ce point sur "${signal.theme}" : ${signal.constat} Quelles sont, selon vous, les causes principales de cette situation, et quels arbitrages ou dépendances la maintiennent ?`;

    case 3:
      return `Sur le sujet "${signal.theme}", qu’est-ce qui reste aujourd’hui insuffisamment piloté, formalisé ou sécurisé ? Quels impacts concrets observez-vous déjà ?`;

    default:
      return `Pouvez-vous préciser ce point sur le thème "${signal.theme}" ?`;
  }
}

function buildQuestion(
  signal: DiagnosticSignal,
  iteration: IterationNumber,
  index: number
): StructuredQuestion {
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
  const pool = [...getDimensionSignals(session, dimensionId)];
  const frozen = session.frozenDimensions.find((d) => d.dimensionId === dimensionId);
  if (frozen) return [];

  const biasByIteration = (signal: DiagnosticSignal): number => {
    let score = signal.criticalityScore * 2 + signal.confidenceScore;

    if (iteration === 1) {
      if (signal.signalKind === "explicit") score += 30;
      if (
        signal.entryAngle === "mechanism" ||
        signal.entryAngle === "formalization"
      ) {
        score += 20;
      }
    }

    if (iteration === 2) {
      if (
        signal.entryAngle === "causality" ||
        signal.entryAngle === "arbitration"
      ) {
        score += 25;
      }
      if (signal.entryAngle === "dependency") score += 18;
    }

    if (iteration === 3) {
      if (signal.signalKind === "absence") score += 35;
      if (
        signal.entryAngle === "formalization" ||
        signal.entryAngle === "economics"
      ) {
        score += 20;
      }
    }

    return score;
  };

  return pool.sort((a, b) => biasByIteration(b) - biasByIteration(a)).slice(0, count);
}

function buildLegacyQuestions(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  iteration: IterationNumber,
  targetCount: number
): StructuredQuestion[] {
  const selectedSignals = selectSignalsForIteration(
    session,
    dimensionId,
    iteration,
    Math.max(targetCount, 1) * 2
  );

  return uniqueById(
    selectedSignals.map((signal, idx) => buildQuestion(signal, iteration, idx + 1))
  ).slice(0, targetCount);
}

function buildPlannedQuestions(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  iteration: IterationNumber,
  targetCount: number
): StructuredQuestion[] {
  const registry = session.signalRegistry;
  if (!registry) return [];

  try {
    const planned = uniqueById(
      planIterationQuestions({
        registry,
        dimensionId,
        iteration,
        session,
      }).filter(
        (question: StructuredQuestion) =>
          Boolean(question.id) &&
          Boolean(question.signalId) &&
          Boolean(question.theme) &&
          Boolean(question.constat) &&
          Boolean(question.questionOuverte)
      )
    );

    if (planned.length >= targetCount) {
      return planned.slice(0, targetCount);
    }

    const fallback = buildLegacyQuestions(session, dimensionId, iteration, targetCount);

    return uniqueById([...planned, ...fallback]).slice(0, targetCount);
  } catch {
    return buildLegacyQuestions(session, dimensionId, iteration, targetCount);
  }
}

function buildWorkset(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  iteration: IterationNumber,
  reopen = false
): IterationWorkset {
  const targetCount = reopen
    ? Math.max(3, minQuestionsForIteration(iteration))
    : minQuestionsForIteration(iteration);

  const questions = buildPlannedQuestions(
    session,
    dimensionId,
    iteration,
    targetCount
  );

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

function deriveRootCause(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  signals: DiagnosticSignal[]
): string {
  const themeMemory = (session.analysisMemory ?? []).filter(
    (item) =>
      item.dimensionId === dimensionId &&
      item.isUsableBusinessMatter &&
      (item.detectedRootCauses?.length ?? 0) > 0
  );

  const causeCounts = new Map<string, number>();

  for (const item of themeMemory) {
    for (const cause of item.detectedRootCauses ?? []) {
      causeCounts.set(cause, (causeCounts.get(cause) ?? 0) + 1);
    }
  }

  const topCause = [...causeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  if (topCause === "skills" || topCause === "experience") {
    return "Le diagnostic converge vers un problème de compétences disponibles, d’expérience ou de maturité sur les sujets critiques.";
  }

  if (topCause === "decision") {
    return "Le diagnostic converge vers des décisions inadaptées, tardives ou insuffisamment sécurisées dans les points clés.";
  }

  if (topCause === "arbitration") {
    return "Le diagnostic converge vers une chaîne d’arbitrage insuffisamment clarifiée ou trop centralisée.";
  }

  if (topCause === "organization") {
    return "Le diagnostic converge vers un problème de cadre, de rôles ou d’organisation du pilotage.";
  }

  if (topCause === "resources") {
    return "Le diagnostic converge vers une tension structurelle de ressources, de capacité ou de dépendance opérationnelle.";
  }

  if (topCause === "pricing" || topCause === "cash") {
    return "Le diagnostic converge vers un désalignement entre pilotage opérationnel et impact économique réel.";
  }

  const text = signals
    .map((s) => `${s.theme} ${s.managerialRisk} ${s.probableConsequence}`)
    .join(" ")
    .toLowerCase();

  if (
    text.includes("non document") ||
    text.includes("non suivi") ||
    text.includes("formalis")
  ) {
    return "Pilotage insuffisamment formalisé sur des sujets structurants.";
  }

  if (
    text.includes("arbitrage") ||
    text.includes("décide") ||
    text.includes("validation")
  ) {
    return "Chaîne d’arbitrage insuffisamment clarifiée ou trop centralisée.";
  }

  if (
    text.includes("dépend") ||
    text.includes("clé") ||
    text.includes("quelques personnes")
  ) {
    return "Dépendance excessive à des personnes ou relais clés.";
  }

  if (
    text.includes("marge") ||
    text.includes("cash") ||
    text.includes("rentabilité")
  ) {
    return "Pilotage économique insuffisamment relié aux décisions opérationnelles ou commerciales.";
  }

  return "Écarts entre fonctionnement réel, responsabilités tenues et cadre de pilotage attendu.";
}

function getLatestFactsByTheme(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): Map<string, string> {
  const latestFactsByTheme = new Map<string, string>();

  for (const item of session.analysisMemory ?? []) {
    if (
      item.dimensionId === dimensionId &&
      item.theme &&
      item.isUsableBusinessMatter &&
      (item.extractedFacts?.length ?? 0) > 0
    ) {
      latestFactsByTheme.set(
        normalizeForMatch(item.theme),
        item.extractedFacts[0]
      );
    }
  }

  return latestFactsByTheme;
}

function buildConsolidatedFindings(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  signals: DiagnosticSignal[]
): [string, string, string] {
  const top = [...signals]
    .sort((a, b) => b.criticalityScore - a.criticalityScore)
    .slice(0, 3);

  const latestFactsByTheme = getLatestFactsByTheme(session, dimensionId);

  const findings = top.map((signal) => {
    const fact = latestFactsByTheme.get(normalizeForMatch(signal.theme));
    const factPart = fact ? ` Élément confirmé en échange : ${shortenText(fact, 140)}.` : "";

    return `${signal.theme} — ${signal.constat.replace(/\.$/, "")}. Conséquence probable : ${signal.probableConsequence.replace(/\.$/, "")}.${factPart}`;
  });

  while (findings.length < 3) {
    findings.push(
      "Un ensemble de sujets reste partiellement documenté, ce qui limite la robustesse du diagnostic et révèle une zone de pilotage à sécuriser."
    );
  }

  return [findings[0], findings[1], findings[2]];
}

function buildUnmanagedZones(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  signals: DiagnosticSignal[]
): ZoneNonPilotee[] {
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

  const latestFactsByTheme = getLatestFactsByTheme(session, dimensionId);

  return selected.map((signal) => {
    const fact = latestFactsByTheme.get(normalizeForMatch(signal.theme));
    const constat = fact
      ? `${signal.constat} Fait terrain mentionné : ${shortenText(fact, 140)}.`
      : signal.constat;

    return {
      constat,
      risqueManagerial: signal.managerialRisk,
      consequence: signal.probableConsequence,
    };
  });
}

function freezeDimension(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): FrozenDimensionDiagnosis {
  const signals = getDimensionSignals(session, dimensionId);

  return {
    dimensionId,
    score: conservativeScoreFromSignals(signals),
    consolidatedFindings: buildConsolidatedFindings(session, dimensionId, signals),
    dominantRootCause: deriveRootCause(session, dimensionId, signals),
    unmanagedZones: buildUnmanagedZones(session, dimensionId, signals),
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
      `Point de départ : ${
        mainZone?.consequence ?? "conséquence à préciser en validation dirigeant"
      }`,
    ],
    validationStatus: "proposed",
    quickWin: `Sécuriser en premier le point : ${
      mainZone?.constat ?? frozen.consolidatedFindings[0]
    }`,
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

function createBootstrappedSessionFromRegistry(params: {
  sessionId: string;
  rawTrameText: string;
  signalRegistry: ReturnType<typeof buildSignalRegistry>;
}): DiagnosticSessionAggregate {
  const trame = readBaseTrame(params.rawTrameText);

  let session = createEmptySessionAggregate(params.sessionId);
  session = {
    ...session,
    phase: "dimension_iteration",
    trame,
    signalRegistry: params.signalRegistry,
    currentDimensionId: 1,
    currentIteration: 1,
  };

  session.currentWorkset = buildWorkset(session, 1, 1, false);

  return touchSession(withSafeMemory(session));
}

export function bootstrapSessionFromTrame(params: {
  sessionId: string;
  rawTrameText: string;
}): DiagnosticSessionAggregate {
  const trame = readBaseTrame(params.rawTrameText);
  const signalRegistry = buildSignalRegistry(trame);

  return createBootstrappedSessionFromRegistry({
    sessionId: params.sessionId,
    rawTrameText: params.rawTrameText,
    signalRegistry,
  });
}

export async function bootstrapSessionFromTrameWithLlm(params: {
  sessionId: string;
  rawTrameText: string;
}): Promise<DiagnosticSessionAggregate> {
  const trame = readBaseTrame(params.rawTrameText);
  const signalRegistry = await buildSignalRegistryWithLlm(trame);

  return createBootstrappedSessionFromRegistry({
    sessionId: params.sessionId,
    rawTrameText: params.rawTrameText,
    signalRegistry,
  });
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
    nextWorkset.closureAskedAt = new Date().toISOString();
    nextSession.phase = "iteration_validation";
  }

  return touchSession(withSafeMemory(nextSession));
}

export function submitIterationClosure(params: {
  session: DiagnosticSessionAggregate;
  decision: ValidationDecision;
}): DiagnosticSessionAggregate {
  let session = withSafeMemory(params.session);

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

    return touchSession(withSafeMemory(session));
  }

  if (!isLastIteration(currentWorkset.iteration)) {
    const nextIteration = nextIterationNumber(currentWorkset.iteration)!;

    session = {
      ...session,
      phase: "dimension_iteration",
      currentIteration: nextIteration,
      currentWorkset: buildWorkset(
        session,
        currentWorkset.dimensionId,
        nextIteration,
        false
      ),
    };

    return touchSession(withSafeMemory(session));
  }

  const frozen = freezeDimension(session, currentWorkset.dimensionId);
  const existing = session.frozenDimensions.filter(
    (item) => item.dimensionId !== currentWorkset.dimensionId
  );

  session = {
    ...session,
    frozenDimensions: [...existing, frozen].sort(
      (a, b) => a.dimensionId - b.dimensionId
    ),
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

    return touchSession(withSafeMemory(session));
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

  return touchSession(withSafeMemory(session));
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
  const { session: rawSession, decisions } = params;
  const session = withSafeMemory(rawSession);

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

  return touchSession(withSafeMemory(nextSession));
}

export function cloneSession(
  session: DiagnosticSessionAggregate
): DiagnosticSessionAggregate {
  return {
    ...session,
    signalRegistry: session.signalRegistry
      ? cloneRegistry(session.signalRegistry)
      : null,
    currentWorkset: session.currentWorkset
      ? cloneWorkset(session.currentWorkset)
      : null,
    frozenDimensions: [...session.frozenDimensions],
    finalObjectives: session.finalObjectives
      ? {
          ...session.finalObjectives,
          objectives: [...session.finalObjectives.objectives],
        }
      : null,
    analysisMemory: [...(session.analysisMemory ?? [])],
  };
}

export function answeredCount(session: DiagnosticSessionAggregate): number {
  return session.currentWorkset?.answers.length ?? 0;
}

export function answeredQuestionIdSet(
  session: DiagnosticSessionAggregate
): Set<string> {
  return answeredQuestionIds(session.currentWorkset);
}

export function challengeCurrentQuestion(
  session: DiagnosticSessionAggregate,
  message?: string
): StructuredQuestion | null;

export function challengeCurrentQuestion(params: {
  session: DiagnosticSessionAggregate;
  message?: string;
}): StructuredQuestion | null;

export function challengeCurrentQuestion(params: {
  session: DiagnosticSessionAggregate;
  sessionId?: string;
  rawMessage?: string;
  message?: string;
  reason?: string;
}): DiagnosticSessionAggregate;

export function challengeCurrentQuestion(
  arg1:
    | DiagnosticSessionAggregate
    | {
        session: DiagnosticSessionAggregate;
        sessionId?: string;
        rawMessage?: string;
        message?: string;
        reason?: string;
      },
  arg2?: string
): StructuredQuestion | null | DiagnosticSessionAggregate {
  if ("phase" in arg1) {
    return previewChallengedQuestion({
      session: withSafeMemory(arg1),
      rawMessage: arg2,
    });
  }

  if ("rawMessage" in arg1 || "sessionId" in arg1 || "reason" in arg1) {
    return rewriteCurrentQuestionInSession({
      session: withSafeMemory(arg1.session),
      rawMessage: arg1.rawMessage ?? arg1.message,
    });
  }

  return previewChallengedQuestion({
    session: withSafeMemory(arg1.session),
    rawMessage: arg1.message,
  });
}