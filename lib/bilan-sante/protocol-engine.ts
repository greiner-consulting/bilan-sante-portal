import {
  FINAL_OBJECTIVES_HEADER,
  buildIterationClosurePrompt,
  buildIterationHeader,
  dimensionKey,
  dimensionTitle,
  isLastDimension,
  isLastIteration,
  maxQuestionsForIteration,
  minimumFloorForIteration,
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
  touchSession,
  type AnswerRecord,
  type DiagnosticSessionAggregate,
  type DiagnosticSignal,
  type FinalObjectiveSet,
  type FrozenDimensionDiagnosis,
  type ObjectiveSeed,
  type IterationHistoryRecord,
  type IterationWorkset,
  type StructuredQuestion,
  type ZoneNonPilotee,
} from "@/lib/bilan-sante/session-model";
import {
  buildSignalRegistry,
  buildSignalRegistryWithLlm,
} from "@/lib/bilan-sante/signal-extractor";
import { readBaseTrame } from "@/lib/bilan-sante/trame-reader";
import { analyzeUserAnswer } from "@/lib/bilan-sante/answer-analyzer";
import { planIterationQuestionsWithDiagnostics } from "@/lib/bilan-sante/question-planner";
import { decideIterationClosure, trimLowValueTail } from "@/lib/bilan-sante/iteration-closer";
import { rewriteQuestionFromAnalysis } from "@/lib/bilan-sante/question-rewriter";
import {
  closeCoverageForIteration,
  registerWorksetQuestions,
} from "@/lib/bilan-sante/coverage-tracker";
import {
  applyObjectiveDecisions,
  buildFinalObjectiveSetFromFrozenDimensions,
} from "@/lib/bilan-sante/objectives-builder";
import { buildFrozenDimensionNarrativeWithLlm } from "@/lib/bilan-sante/llm-diagnostic-writer";

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

function uniqueStrings(values: Array<string | null | undefined>, max?: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = normalizeForMatch(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (max != null && out.length >= max) break;
  }
  return out;
}

function withSafeMemory(
  session: DiagnosticSessionAggregate
): DiagnosticSessionAggregate {
  return {
    ...session,
    analysisMemory: session.analysisMemory ?? [],
    iterationHistory: session.iterationHistory ?? [],
    themeCoverage: session.themeCoverage ?? [],
    conversationHistory: session.conversationHistory ?? [],
  };
}

function attachWorkset(
  session: DiagnosticSessionAggregate,
  workset: IterationWorkset | null
): DiagnosticSessionAggregate {
  if (!workset) {
    return withSafeMemory({ ...session, currentWorkset: null });
  }
  const nextSession = withSafeMemory({ ...session, currentWorkset: workset });
  return registerWorksetQuestions(nextSession);
}

function getAllSignals(session: DiagnosticSessionAggregate): DiagnosticSignal[] {
  const registry = session.signalRegistry;
  if (!registry) return [];
  if ("all" in registry && Array.isArray(registry.all)) return registry.all;
  if ("allSignals" in registry && Array.isArray(registry.allSignals)) return registry.allSignals;
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

function buildLegacyQuestion(
  signal: DiagnosticSignal,
  iteration: IterationNumber,
  index: number
): StructuredQuestion {
  const excerpt = shortenText(signal.sourceExcerpt, 160);
  let questionOuverte = `Pouvez-vous préciser ce point sur le thème "${signal.theme}" ?`;

  if (iteration === 1) {
    questionOuverte = signal.signalKind === "absence"
      ? `Sur le thème "${signal.theme}", la trame ne permet pas de voir clairement comment le sujet est piloté. Comment ce sujet fonctionne-t-il réellement aujourd’hui, qui intervient, et où se situent les principaux points de fragilité ?`
      : excerpt
      ? `Sur le thème "${signal.theme}", la trame mentionne : "${excerpt}". Concrètement, comment ce sujet est-il géré aujourd’hui dans le fonctionnement réel de l’entreprise ?`
      : `Sur le thème "${signal.theme}", comment ce sujet est-il géré aujourd’hui dans le fonctionnement réel de l’entreprise ?`;
  }

  if (iteration === 2) {
    questionOuverte = `Si l’on creuse ce point sur "${signal.theme}" : ${signal.constat} Quelles sont, selon vous, les causes principales de cette situation, et quels arbitrages ou dépendances la maintiennent ?`;
  }

  if (iteration === 3) {
    questionOuverte = `Sur le sujet "${signal.theme}", quel point reste aujourd’hui le moins piloté ou le moins sécurisé, et quel risque concret cela crée-t-il pour l’entreprise ?`;
  }

  return {
    id: `q-${signal.id}-it${iteration}-${index}`,
    signalId: signal.id,
    theme: signal.theme,
    constat: signal.constat,
    risqueManagerial: signal.managerialRisk,
    questionOuverte,
  };
}

function buildLegacyQuestions(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  iteration: IterationNumber,
  targetCount: number
): StructuredQuestion[] {
  const selectedSignals = [...getDimensionSignals(session, dimensionId)]
    .sort((a, b) => {
      const left = a.criticalityScore + a.confidenceScore;
      const right = b.criticalityScore + b.confidenceScore;
      return right - left;
    })
    .slice(0, Math.max(targetCount, 1) * 2);

  return uniqueById(
    selectedSignals.map((signal, idx) => buildLegacyQuestion(signal, iteration, idx + 1))
  ).slice(0, targetCount);
}

function getPreviousIterationQuestionCount(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  iteration: IterationNumber
): number | null {
  if (iteration === 1) return null;
  const previousIteration = (iteration - 1) as IterationNumber;
  const history = session.iterationHistory ?? [];
  const previous = [...history].reverse().find(
    (item) => item.dimensionId === dimensionId && item.iteration === previousIteration
  );
  return previous?.questionCount ?? null;
}

function computeIterationQuestionPolicy(params: {
  iteration: IterationNumber;
  candidateCount: number;
  previousIterationQuestionCount?: number | null;
}): {
  targetQuestionCount: number;
  minimumRequiredCount: number;
} {
  const { iteration, candidateCount, previousIterationQuestionCount = null } = params;
  let cap = maxQuestionsForIteration(iteration);
  if ((iteration === 2 || iteration === 3) && previousIterationQuestionCount != null) {
    cap = Math.min(cap, previousIterationQuestionCount);
  }
  const targetQuestionCount = Math.max(0, Math.min(candidateCount, cap));
  const floor = minimumFloorForIteration(iteration);
  return {
    targetQuestionCount,
    minimumRequiredCount: targetQuestionCount === 0 ? 0 : Math.min(targetQuestionCount, floor),
  };
}

function applyEmptyWorksetAutoValidation(
  session: DiagnosticSessionAggregate
): DiagnosticSessionAggregate {
  const workset = session.currentWorkset;
  if (!workset) return session;
  if (workset.questions.length > 0) return session;
  if (session.phase !== "dimension_iteration") return session;
  return {
    ...session,
    phase: "iteration_validation",
    currentWorkset: {
      ...workset,
      closureAskedAt: workset.closureAskedAt ?? new Date().toISOString(),
    },
  };
}

async function buildWorkset(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  iteration: IterationNumber,
  reopen = false
): Promise<IterationWorkset> {
  const previousQuestionCount = getPreviousIterationQuestionCount(
    session,
    dimensionId,
    iteration
  );

  const initialTarget = reopen
    ? Math.max(maxQuestionsForIteration(iteration), 5)
    : maxQuestionsForIteration(iteration);

  let questions: StructuredQuestion[] = [];
  let planningDiagnostics = null;
  let planningNotes: string[] = [];

  if (session.signalRegistry) {
    const planned = await planIterationQuestionsWithDiagnostics({
      registry: session.signalRegistry,
      dimensionId,
      iteration,
      session,
    });

    questions = planned.questions;
    planningDiagnostics = {
      generatedAt: new Date().toISOString(),
      strategy: "heuristic_planner_with_llm_composer",
      selectedQuestionIds: planned.questions.map((item) => item.id),
      candidateDiagnostics: planned.diagnostics,
      notes: planned.notes,
    };
    planningNotes = planned.notes;
  }

  if (questions.length === 0) {
    questions = buildLegacyQuestions(session, dimensionId, iteration, initialTarget);
    planningNotes = ["Fallback legacy planner utilisé."];
    planningDiagnostics = {
      generatedAt: new Date().toISOString(),
      strategy: "legacy_fallback",
      selectedQuestionIds: questions.map((item) => item.id),
      candidateDiagnostics: [],
      notes: planningNotes,
    };
  }

  const policy = computeIterationQuestionPolicy({
    iteration,
    candidateCount: questions.length,
    previousIterationQuestionCount: previousQuestionCount,
  });

  const slicedQuestions = questions.slice(0, policy.targetQuestionCount);
  const trimmedQuestions = trimLowValueTail({
    session,
    dimensionId,
    iteration,
    questions: slicedQuestions,
    minimumRequiredCount: policy.minimumRequiredCount,
  });

  const finalPolicy = computeIterationQuestionPolicy({
    iteration,
    candidateCount: trimmedQuestions.length,
    previousIterationQuestionCount: previousQuestionCount,
  });

  return {
    dimensionId,
    iteration,
    header: buildIterationHeader(dimensionId, iteration),
    questions: trimmedQuestions.slice(0, finalPolicy.targetQuestionCount),
    answers: [],
    closurePrompt: buildIterationClosurePrompt(dimensionId, iteration),
    targetQuestionCount: finalPolicy.targetQuestionCount,
    minimumRequiredCount: finalPolicy.minimumRequiredCount,
    sourceIterationQuestionCount: previousQuestionCount,
    planningDiagnostics: planningDiagnostics
      ? {
          ...planningDiagnostics,
          selectedQuestionIds: trimmedQuestions.map((item) => item.id),
          notes: [...planningNotes, `Questions retenues: ${trimmedQuestions.length}.`],
        }
      : null,
  };
}

function conservativeScoreFromSignals(signals: DiagnosticSignal[]): 1 | 2 | 3 | 4 | 5 {
  if (signals.length === 0) return 2;
  const avgCriticality = signals.reduce((sum, item) => sum + item.criticalityScore, 0) / signals.length;
  const absenceRatio = signals.filter((item) => item.signalKind === "absence").length / signals.length;
  const raw = 5 - Math.round((avgCriticality / 100) * 2 + absenceRatio * 2);
  return Math.max(1, Math.min(5, raw)) as 1 | 2 | 3 | 4 | 5;
}

function deriveRootCause(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  signals: DiagnosticSignal[]
): string {
  const themeMemory = (session.analysisMemory ?? []).filter(
    (item) => item.dimensionId === dimensionId && item.isUsableBusinessMatter && (item.detectedRootCauses?.length ?? 0) > 0
  );

  const causeCounts = new Map<string, number>();
  for (const item of themeMemory) {
    for (const cause of item.detectedRootCauses ?? []) {
      causeCounts.set(cause, (causeCounts.get(cause) ?? 0) + 1);
    }
  }

  const topCause = [...causeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  if (topCause === "skills" || topCause === "experience") return "Le diagnostic converge vers un problème de compétences disponibles, d’expérience ou de maturité sur les sujets critiques.";
  if (topCause === "decision") return "Le diagnostic converge vers des décisions inadaptées, tardives ou insuffisamment sécurisées dans les points clés.";
  if (topCause === "arbitration") return "Le diagnostic converge vers une chaîne d’arbitrage insuffisamment clarifiée ou trop centralisée.";
  if (topCause === "organization") return "Le diagnostic converge vers un problème de cadre, de rôles ou d’organisation du pilotage.";
  if (topCause === "resources") return "Le diagnostic converge vers une tension structurelle de ressources, de capacité ou de dépendance opérationnelle.";
  if (topCause === "pricing" || topCause === "cash") return "Le diagnostic converge vers un désalignement entre pilotage opérationnel et impact économique réel.";

  const text = signals.map((s) => `${s.theme} ${s.managerialRisk} ${s.probableConsequence}`).join(" ").toLowerCase();
  if (text.includes("non document") || text.includes("non suivi") || text.includes("formalis")) return "Pilotage insuffisamment formalisé sur des sujets structurants.";
  if (text.includes("arbitrage") || text.includes("decide") || text.includes("décide") || text.includes("validation")) return "Chaîne d’arbitrage insuffisamment clarifiée ou trop centralisée.";
  if (text.includes("depend") || text.includes("dépend") || text.includes("clé")) return "Dépendance excessive à des personnes ou relais clés.";
  if (text.includes("marge") || text.includes("cash") || text.includes("rentabilité")) return "Pilotage économique insuffisamment relié aux décisions opérationnelles ou commerciales.";
  return "Écarts entre fonctionnement réel, responsabilités tenues et cadre de pilotage attendu.";
}

function getLatestFactsByTheme(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): Map<string, string[]> {
  const latestFactsByTheme = new Map<string, string[]>();
  for (const item of session.analysisMemory ?? []) {
    if (item.dimensionId !== dimensionId || !item.theme || !item.isUsableBusinessMatter) continue;
    const facts = uniqueStrings(item.extractedFacts ?? [], 3);
    if (facts.length === 0) continue;
    latestFactsByTheme.set(normalizeForMatch(item.theme), facts);
  }
  return latestFactsByTheme;
}

function prioritizeSignalsForFreeze(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  signals: DiagnosticSignal[]
): DiagnosticSignal[] {
  const latestFactsByTheme = getLatestFactsByTheme(session, dimensionId);
  return [...signals].sort((a, b) => {
    const aFactBonus = (latestFactsByTheme.get(normalizeForMatch(a.theme))?.length ?? 0) * 12;
    const bFactBonus = (latestFactsByTheme.get(normalizeForMatch(b.theme))?.length ?? 0) * 12;
    const aExplicit = a.signalKind === "explicit" ? 18 : 0;
    const bExplicit = b.signalKind === "explicit" ? 18 : 0;
    const aScore = a.criticalityScore + a.confidenceScore + aFactBonus + aExplicit;
    const bScore = b.criticalityScore + b.confidenceScore + bFactBonus + bExplicit;
    return bScore - aScore;
  });
}

function buildConsolidatedFindings(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  signals: DiagnosticSignal[]
): [string, string, string] {
  const prioritized = prioritizeSignalsForFreeze(session, dimensionId, signals).slice(0, 3);
  const latestFactsByTheme = getLatestFactsByTheme(session, dimensionId);

  const findings = prioritized.map((signal) => {
    const facts = latestFactsByTheme.get(normalizeForMatch(signal.theme)) ?? [];
    const factPart =
      facts.length > 0
        ? ` Élément confirmé en échange : ${facts.map((fact) => shortenText(fact, 120)).join(" | ")}.`
        : "";
    return `${signal.theme} — ${signal.constat.replace(/\.$/, "")}. Risque clé : ${signal.managerialRisk.replace(/\.$/, "")}. Conséquence probable : ${signal.probableConsequence.replace(/\.$/, "")}.${factPart}`;
  });

  while (findings.length < 3) {
    findings.push("Un ensemble de sujets reste partiellement documenté, ce qui limite la robustesse du diagnostic et révèle une zone de pilotage à sécuriser.");
  }

  return [findings[0], findings[1], findings[2]];
}

function buildUnmanagedZones(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  signals: DiagnosticSignal[]
): ZoneNonPilotee[] {
  const prioritized = prioritizeSignalsForFreeze(session, dimensionId, signals);
  const selected = prioritized
    .filter((s, index) => {
      if (index < 2 && s.signalKind === "explicit") return true;
      return s.signalKind === "absence" || s.criticalityScore >= 82;
    })
    .slice(0, 3);

  if (selected.length === 0) {
    return [
      {
        constat: "Peu de zones non pilotées massives ressortent, mais plusieurs sujets restent dépendants d’usages plus que d’un cadre structuré.",
        risqueManagerial: "Risque de dérive progressive sans signal faible suffisamment remonté.",
        consequence: "Dégradation lente de la tenue des engagements, de la coordination ou de la visibilité économique.",
      },
    ];
  }

  const latestFactsByTheme = getLatestFactsByTheme(session, dimensionId);

  return selected.map((signal) => {
    const facts = latestFactsByTheme.get(normalizeForMatch(signal.theme)) ?? [];
    const factPart =
      facts.length > 0
        ? ` Fait terrain mentionné : ${facts.map((fact) => shortenText(fact, 120)).join(" | ")}.`
        : "";
    return {
      constat: `${signal.constat}${factPart}`,
      risqueManagerial: signal.managerialRisk,
      consequence: signal.probableConsequence,
    };
  });
}

function getExploredSignalsForDimension(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): DiagnosticSignal[] {
  const registrySignals = getDimensionSignals(session, dimensionId);
  const exploredSignalIds = new Set<string>();

  for (const item of session.analysisMemory ?? []) {
    if (item.dimensionId === dimensionId && item.signalId) exploredSignalIds.add(item.signalId);
  }

  for (const turn of session.conversationHistory ?? []) {
    if (turn.role === "question" && turn.dimensionId === dimensionId && turn.signalId) exploredSignalIds.add(turn.signalId);
  }

  const exploredThemes = new Set(
    (session.themeCoverage ?? [])
      .filter((item) => item.dimensionId === dimensionId)
      .map((item) => normalizeForMatch(item.theme))
  );

  const filtered = registrySignals.filter(
    (signal) => exploredSignalIds.has(signal.id) || exploredThemes.has(normalizeForMatch(signal.theme))
  );

  if (filtered.length >= 4) {
    return uniqueById(filtered);
  }

  const supplements = prioritizeSignalsForFreeze(session, dimensionId, registrySignals)
    .filter((signal) => signal.signalKind === "explicit")
    .filter((signal) => !filtered.some((item) => item.id === signal.id))
    .slice(0, Math.max(0, 4 - filtered.length));

  return uniqueById([...filtered, ...supplements]).length > 0
    ? uniqueById([...filtered, ...supplements])
    : registrySignals;
}


function extractQuotedTheme(value: string | null | undefined): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const quoted = text.match(/th[èe]me\s*["«]([^"»]+)["»]/i);
  if (quoted?.[1]) return normalizeText(quoted[1]);
  return null;
}

function firstSentence(value: string | null | undefined): string {
  const text = normalizeText(value);
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return normalizeText(match?.[1] ?? text);
}

function thematicFocusLabel(value: string | null | undefined): string {
  const theme = extractQuotedTheme(value);
  if (theme) return theme;

  const sentence = firstSentence(value)
    .replace(/^le\s+th[èe]me\s+/i, "")
    .replace(/^sur\s+le\s+th[èe]me\s+/i, "")
    .replace(/^la\s+zone\s+/i, "")
    .replace(/^le\s+point\s+/i, "")
    .replace(/^constat\s*:\s*/i, "")
    .replace(/^risque\s+manag[ée]rial\s*:\s*/i, "")
    .replace(/^cons[ée]quence\s*:\s*/i, "")
    .trim();

  return shortenText(sentence, 120) || "zone non pilotée dominante";
}

function lowerFirst(value: string | null | undefined): string {
  const text = normalizeText(value);
  if (!text) return "";
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function buildDimensionSummary(params: {
  dimensionId: DimensionId;
  consolidatedFindings: [string, string, string];
  dominantRootCause: string;
  unmanagedZones: ZoneNonPilotee[];
}): string {
  const dominantZone = params.unmanagedZones[0];
  const leadingFinding = params.consolidatedFindings[0];

  if (dominantZone) {
    return `Sur la dimension "${dimensionTitle(params.dimensionId)}", les constats consolidés convergent vers ${lowerFirst(params.dominantRootCause)}. La zone non pilotée dominante porte sur ${thematicFocusLabel(dominantZone.constat)}, avec un risque principal de ${lowerFirst(dominantZone.risqueManagerial)} et une conséquence probable de ${lowerFirst(dominantZone.consequence)}.`;
  }

  return `Sur la dimension "${dimensionTitle(params.dimensionId)}", les constats consolidés convergent vers ${lowerFirst(params.dominantRootCause)}. Le constat structurant le plus saillant reste : ${lowerFirst(leadingFinding)}.`;
}

function buildEvidenceSummary(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  signals: DiagnosticSignal[],
  consolidatedFindings: [string, string, string]
): string[] {
  const factsByTheme = getLatestFactsByTheme(session, dimensionId);
  const evidence: string[] = [];

  for (const signal of prioritizeSignalsForFreeze(session, dimensionId, signals).slice(0, 4)) {
    const facts = factsByTheme.get(normalizeForMatch(signal.theme)) ?? [];
    if (facts.length > 0) {
      evidence.push(`${signal.theme} — ${facts.map((fact) => shortenText(fact, 120)).join(' | ')}`);
      continue;
    }

    if (signal.sourceExcerpt) {
      evidence.push(`${signal.theme} — ${shortenText(signal.sourceExcerpt, 150)}`);
      continue;
    }

    evidence.push(`${signal.theme} — ${shortenText(signal.constat, 150)}`);
  }

  return uniqueStrings([...evidence, ...consolidatedFindings.map((item) => shortenText(item, 160))], 5);
}

function buildObjectiveLabelFromZone(
  dimensionId: DimensionId,
  zone: ZoneNonPilotee | undefined,
  dominantRootCause: string
): string {
  if (!zone) {
    return `Sous 6 mois, réduire l’exposition de la dimension "${dimensionTitle(dimensionId)}" à la cause racine dominante`;
  }

  const focus = thematicFocusLabel(zone.constat);
  const text = normalizeForMatch(`${zone.constat} ${zone.risqueManagerial} ${zone.consequence}`);

  if (text.includes('arbitr')) {
    return `Sous 6 mois, rendre pilotable la zone dominante "${focus}" en clarifiant les arbitrages qui la bloquent`;
  }
  if (text.includes('depend') || text.includes('dépend') || text.includes('relais') || text.includes('personne cle')) {
    return `Sous 6 mois, rendre pilotable la zone dominante "${focus}" en réduisant la dépendance critique qui la fragilise`;
  }
  if (text.includes('marge') || text.includes('cash') || text.includes('prix') || text.includes('cout') || text.includes('coût') || text.includes('rentabil')) {
    return `Sous 6 mois, rendre pilotable la zone dominante "${focus}" en reconnectant le pilotage opérationnel à son impact économique réel`;
  }
  if (text.includes('role') || text.includes('rôle') || text.includes('organisation') || text.includes('recrut') || text.includes('equipe') || text.includes('équipe')) {
    return `Sous 6 mois, rendre pilotable la zone dominante "${focus}" en sécurisant les rôles, relais et responsabilités associés`;
  }

  return `Sous 6 mois, rendre pilotable la zone dominante "${focus}" et réduire le risque managérial associé`;
}

function buildObjectiveIndicatorFromZone(
  zone: ZoneNonPilotee | undefined,
  dominantRootCause: string
): string {
  const text = normalizeForMatch(`${zone?.constat ?? ''} ${zone?.risqueManagerial ?? ''} ${zone?.consequence ?? ''} ${dominantRootCause}`);

  if (text.includes('arbitr')) {
    return 'Délai d’arbitrage, taux de décisions escaladées, part des décisions prises au bon niveau';
  }
  if (text.includes('depend') || text.includes('dépend') || text.includes('relais') || text.includes('personne cle')) {
    return 'Taux de couverture des relais, nombre de points tenus sans personne clé, niveau de dépendance critique';
  }
  if (text.includes('marge') || text.includes('cash') || text.includes('prix') || text.includes('cout') || text.includes('coût') || text.includes('rentabil')) {
    return 'Écart prix vendu / coût réel, marge tenue, visibilité cash sur le point dominant';
  }
  if (text.includes('role') || text.includes('rôle') || text.includes('organisation') || text.includes('recrut') || text.includes('equipe') || text.includes('équipe')) {
    return 'Couverture des rôles clés, stabilité des relais, tenue du pilotage sur la zone dominante';
  }

  return 'Indicateur de maîtrise de la zone dominante, fréquence de revue et taux de traitement des écarts';
}

function buildObjectiveQuickWinFromZone(zone: ZoneNonPilotee | undefined): string {
  if (!zone) {
    return 'Nommer un propriétaire et formaliser un premier point de revue sur la zone dominante dans le mois.';
  }

  const focus = thematicFocusLabel(zone.constat);
  return `Dans les 30 jours, nommer un propriétaire, clarifier la règle de pilotage et installer un point de revue sur "${focus}".`;
}

function buildObjectivePotentialGainFromZone(zone: ZoneNonPilotee | undefined): string {
  if (!zone) {
    return 'Gain à préciser en validation finale sur la réduction de l’exposition managériale dominante.';
  }

  return `Gain à préciser en validation finale, en lien direct avec la conséquence prioritaire identifiée : ${shortenText(zone.consequence, 150)}`;
}

function buildObjectiveSeedsForFrozenDimension(params: {
  dimensionId: DimensionId;
  dominantRootCause: string;
  consolidatedFindings: [string, string, string];
  unmanagedZones: ZoneNonPilotee[];
}): ObjectiveSeed[] {
  const zones = params.unmanagedZones.slice(0, 3);
  const seeds: ObjectiveSeed[] = [];

  zones.forEach((zone, index) => {
    seeds.push({
      id: `seed-d${params.dimensionId}-${index + 1}`,
      label: buildObjectiveLabelFromZone(params.dimensionId, zone, params.dominantRootCause),
      rationale: `${shortenText(zone.constat, 150)} Risque : ${shortenText(zone.risqueManagerial, 130)}`,
      indicator: buildObjectiveIndicatorFromZone(zone, params.dominantRootCause),
      suggestedDueDate: index === 0 ? '90 jours pour sécuriser le cadre / 6 mois pour tenir le résultat' : 'À séquencer après traitement de la zone dominante',
      potentialGain: buildObjectivePotentialGainFromZone(zone),
      quickWin: buildObjectiveQuickWinFromZone(zone),
      priority: index === 0 ? 'high' : index === 1 ? 'medium' : 'low',
      priorityScore: index === 0 ? 100 : index === 1 ? 74 : 58,
    });
  });

  if (seeds.length === 0) {
    seeds.push({
      id: `seed-d${params.dimensionId}-fallback`,
      label: `Sous 6 mois, réduire l’exposition de la dimension "${dimensionTitle(params.dimensionId)}" à la cause racine dominante`,
      rationale: params.dominantRootCause,
      indicator: buildObjectiveIndicatorFromZone(undefined, params.dominantRootCause),
      suggestedDueDate: 'À définir avec le dirigeant',
      potentialGain: 'Gain à préciser en validation finale sur la réduction de l’exposition dominante.',
      quickWin: 'Nommer un propriétaire, formaliser une cible et installer un premier rituel de revue.',
      priority: 'high',
      priorityScore: 60,
    });
  }

  return seeds;
}

async function freezeDimension(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): Promise<FrozenDimensionDiagnosis> {
  const signals = getExploredSignalsForDimension(session, dimensionId);
  const exploredThemes = [...new Set(signals.map((signal) => signal.theme))];
  const exploredSignalIds = signals.map((signal) => signal.id);

  const fallback = {
    consolidatedFindings: buildConsolidatedFindings(session, dimensionId, signals),
    dominantRootCause: deriveRootCause(session, dimensionId, signals),
    unmanagedZones: buildUnmanagedZones(session, dimensionId, signals),
  };

  const llmNarrative = await buildFrozenDimensionNarrativeWithLlm({
    dimensionId,
    dimensionTitle: dimensionTitle(dimensionId),
    signals,
    memory: (session.analysisMemory ?? []).filter((item) => item.dimensionId === dimensionId),
    fallback,
  });

  const summary = buildDimensionSummary({
    dimensionId,
    consolidatedFindings: llmNarrative.consolidatedFindings,
    dominantRootCause: llmNarrative.dominantRootCause,
    unmanagedZones: llmNarrative.unmanagedZones,
  });

  const evidenceSummary = buildEvidenceSummary(
    session,
    dimensionId,
    signals,
    llmNarrative.consolidatedFindings
  );

  const objectiveSeeds = buildObjectiveSeedsForFrozenDimension({
    dimensionId,
    dominantRootCause: llmNarrative.dominantRootCause,
    consolidatedFindings: llmNarrative.consolidatedFindings,
    unmanagedZones: llmNarrative.unmanagedZones,
  });

  return {
    dimensionId,
    score: conservativeScoreFromSignals(signals),
    consolidatedFindings: llmNarrative.consolidatedFindings,
    dominantRootCause: llmNarrative.dominantRootCause,
    unmanagedZones: llmNarrative.unmanagedZones,
    frozenAt: new Date().toISOString(),
    exploredThemes,
    exploredSignalIds,
    summary,
    evidenceSummary,
    keyFindings: llmNarrative.consolidatedFindings,
    nonPilotedAreas: llmNarrative.unmanagedZones,
    objectiveSeeds,
  };
}

function requireCurrentWorkset(session: DiagnosticSessionAggregate): IterationWorkset {
  if (!session.currentWorkset) throw new Error("Aucune itération active dans la session.");
  return session.currentWorkset;
}

function appendIterationHistory(
  session: DiagnosticSessionAggregate,
  record: IterationHistoryRecord
): DiagnosticSessionAggregate {
  const history = session.iterationHistory ?? [];
  const filtered = history.filter(
    (item) => !(item.dimensionId === record.dimensionId && item.iteration === record.iteration)
  );
  return {
    ...session,
    iterationHistory: [...filtered, record].sort((a, b) => {
      if (a.dimensionId !== b.dimensionId) return a.dimensionId - b.dimensionId;
      return a.iteration - b.iteration;
    }),
  };
}

async function createBootstrappedSessionFromRegistry(params: {
  sessionId: string;
  rawTrameText: string;
  signalRegistry: ReturnType<typeof buildSignalRegistry>;
}): Promise<DiagnosticSessionAggregate> {
  const trame = readBaseTrame(params.rawTrameText);
  let session = createEmptySessionAggregate(params.sessionId);
  session = withSafeMemory({
    ...session,
    phase: "dimension_iteration",
    trame,
    signalRegistry: params.signalRegistry,
    currentDimensionId: 1,
    currentIteration: 1,
  });

  const workset = await buildWorkset(session, 1, 1, false);
  session = attachWorkset(session, workset);
  session = applyEmptyWorksetAutoValidation(session);
  return touchSession(withSafeMemory(session));
}

export async function bootstrapSessionFromTrame(params: {
  sessionId: string;
  rawTrameText: string;
}): Promise<DiagnosticSessionAggregate> {
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
      assistantMessage: "Le diagnostic ne peut pas démarrer sans trame de base exploitée.",
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
      (objective, index) => `${index + 1}. ${objective.objectiveLabel} — ${objective.keyIndicator}`
    );
    return {
      assistantMessage: `${FINAL_OBJECTIVES_HEADER}\n\nObjectifs proposés :\n${lines.join("\n")}\n\nMerci d’indiquer pour chaque objectif : Validé / Ajusté / Refusé.`,
      questions: [],
      needsValidation: true,
      phase: session.phase,
      currentDimensionId: null,
      currentIteration: null,
    };
  }

  if (session.phase === "report_ready") {
    return {
      assistantMessage: "Le diagnostic est séquencé, les 4 dimensions sont gelées et l’itération finale objectifs est capturée. La session est prête pour le report builder standardisé.",
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
  if (session.phase !== "dimension_iteration") throw new Error("La session n’est pas en phase de questions.");
  const workset = requireCurrentWorkset(session);
  const question = workset.questions.find((q) => q.id === questionId);
  if (!question) throw new Error(`Question introuvable: ${questionId}`);
  const alreadyAnswered = workset.answers.some((a) => a.questionId === questionId);
  if (alreadyAnswered) throw new Error(`La question ${questionId} a déjà reçu une réponse.`);

  const nextAnswer: AnswerRecord = {
    questionId,
    answerText: String(answerText ?? "").trim(),
    answeredAt: new Date().toISOString(),
  };

  const nextWorkset: IterationWorkset = { ...workset, answers: [...workset.answers, nextAnswer] };
  let nextSession: DiagnosticSessionAggregate = withSafeMemory({ ...session, currentWorkset: nextWorkset });

  const closure = decideIterationClosure(nextSession);
  if (closure.shouldAskValidation) {
    nextSession = {
      ...nextSession,
      phase: "iteration_validation",
      currentWorkset: {
        ...nextWorkset,
        closureAskedAt: nextWorkset.closureAskedAt ?? new Date().toISOString(),
        closureDiagnostics: {
          decidedAt: new Date().toISOString(),
          qualityStop: closure.qualityStop,
          remainingLowValue: closure.remainingLowValue,
          uncoveredMandatoryAngles: closure.uncoveredMandatoryAngles,
          highValueRemainderQuestionIds: closure.highValueRemainderQuestionIds,
          reasonCodes: closure.reasonCodes,
          notes: closure.notes,
        },
      },
    };
  }

  return touchSession(withSafeMemory(nextSession));
}

export async function submitIterationClosure(params: {
  session: DiagnosticSessionAggregate;
  decision: ValidationDecision;
}): Promise<DiagnosticSessionAggregate> {
  let session = withSafeMemory(params.session);
  if (session.phase !== "iteration_validation") throw new Error("La session n’attend pas de validation d’itération.");
  const currentWorkset = requireCurrentWorkset(session);

  if (params.decision === "no") {
    const workset = await buildWorkset(session, currentWorkset.dimensionId, currentWorkset.iteration, true);
    session = attachWorkset({ ...session, phase: "dimension_iteration" }, workset);
    session = applyEmptyWorksetAutoValidation(session);
    return touchSession(withSafeMemory(session));
  }

  session = appendIterationHistory(session, {
    dimensionId: currentWorkset.dimensionId,
    iteration: currentWorkset.iteration,
    questionCount: currentWorkset.questions.length,
    answeredCount: currentWorkset.answers.length,
    closedAt: new Date().toISOString(),
  });

  session = closeCoverageForIteration(session, currentWorkset.dimensionId, currentWorkset.iteration);

  if (!isLastIteration(currentWorkset.iteration)) {
    const nextIteration = nextIterationNumber(currentWorkset.iteration)!;
    const workset = await buildWorkset(session, currentWorkset.dimensionId, nextIteration, false);
    session = attachWorkset({ ...session, phase: "dimension_iteration", currentIteration: nextIteration }, workset);
    session = applyEmptyWorksetAutoValidation(session);
    return touchSession(withSafeMemory(session));
  }

  const frozen = await freezeDimension(session, currentWorkset.dimensionId);
  const existing = session.frozenDimensions.filter((item) => item.dimensionId !== currentWorkset.dimensionId);
  session = {
    ...session,
    frozenDimensions: [...existing, frozen].sort((a, b) => a.dimensionId - b.dimensionId),
  };

  if (!isLastDimension(currentWorkset.dimensionId)) {
    const nextDimension = nextDimensionId(currentWorkset.dimensionId)!;
    const workset = await buildWorkset(session, nextDimension, 1, false);
    session = attachWorkset({ ...session, phase: "dimension_iteration", currentDimensionId: nextDimension, currentIteration: 1 }, workset);
    session = applyEmptyWorksetAutoValidation(session);
    return touchSession(withSafeMemory(session));
  }

  const finalObjectives = buildFinalObjectiveSetFromFrozenDimensions(session.frozenDimensions);
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
    adjustedPotentialGain?: string;
    adjustedQuickWin?: string;
  }>;
}): DiagnosticSessionAggregate {
  const { session: rawSession, decisions } = params;
  const session = withSafeMemory(rawSession);
  if (session.phase !== "final_objectives_validation" || !session.finalObjectives) {
    throw new Error("La session n’est pas en phase finale de validation des objectifs.");
  }

  const nextObjectives = applyObjectiveDecisions({
    objectives: session.finalObjectives.objectives,
    decisions,
  });

  const nextSession: DiagnosticSessionAggregate = {
    ...session,
    phase: "report_ready",
    finalObjectives: {
      ...session.finalObjectives,
      objectives: nextObjectives,
      decisionsCapturedAt: new Date().toISOString(),
    } as FinalObjectiveSet,
  };

  return touchSession(withSafeMemory(nextSession));
}

export function cloneSession(session: DiagnosticSessionAggregate): DiagnosticSessionAggregate {
  return {
    ...session,
    signalRegistry: session.signalRegistry ? cloneRegistry(session.signalRegistry) : null,
    currentWorkset: session.currentWorkset ? cloneWorkset(session.currentWorkset) : null,
    frozenDimensions: [...session.frozenDimensions],
    finalObjectives: session.finalObjectives ? { ...session.finalObjectives, objectives: [...session.finalObjectives.objectives] } : null,
    analysisMemory: [...(session.analysisMemory ?? [])],
    iterationHistory: [...(session.iterationHistory ?? [])],
    themeCoverage: [...(session.themeCoverage ?? [])],
    conversationHistory: [...(session.conversationHistory ?? [])],
  };
}

export function answeredCount(session: DiagnosticSessionAggregate): number {
  return session.currentWorkset?.answers.length ?? 0;
}

export function answeredQuestionIdSet(session: DiagnosticSessionAggregate): Set<string> {
  return answeredQuestionIds(session.currentWorkset);
}
export function challengeCurrentQuestion(
  session: DiagnosticSessionAggregate,
  message?: string
): Promise<StructuredQuestion | null>;

export function challengeCurrentQuestion(params: {
  session: DiagnosticSessionAggregate;
  message?: string;
}): Promise<StructuredQuestion | null>;

export function challengeCurrentQuestion(params: {
  session: DiagnosticSessionAggregate;
  sessionId?: string;
  rawMessage?: string;
  message?: string;
  reason?: string;
}): Promise<DiagnosticSessionAggregate>;

export async function challengeCurrentQuestion(
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
): Promise<StructuredQuestion | null | DiagnosticSessionAggregate> {
  const preview =
    "phase" in arg1 ? withSafeMemory(arg1) : withSafeMemory(arg1.session);

  const rawMessage =
    ("phase" in arg1 ? arg2 : arg1.rawMessage ?? arg1.message) ?? "";

  const workset = preview.currentWorkset;
  const currentQuestion = getCurrentUnansweredQuestion(workset);

  if (!workset || !currentQuestion || !normalizeText(rawMessage)) {
    return "phase" in arg1 ? currentQuestion : preview;
  }

  const signal = findSignalById(preview, currentQuestion.signalId);

  const analysis = analyzeUserAnswer({
    rawMessage,
    currentQuestion: {
      theme: currentQuestion.theme,
      constat: currentQuestion.constat,
      questionOuverte: currentQuestion.questionOuverte,
      entryAngle: signal?.entryAngle ?? null,
    },
  });

  const nextQuestionOuverte = await rewriteQuestionFromAnalysis({
    session: preview,
    question: currentQuestion,
    rawMessage,
    analysis,
    dimensionId: workset.dimensionId,
    iteration: workset.iteration,
    currentAngle: signal?.entryAngle ?? null,
  });

  const rewrittenQuestion: StructuredQuestion = {
    ...currentQuestion,
    questionOuverte: nextQuestionOuverte,
  };

  if ("phase" in arg1) {
    return rewrittenQuestion;
  }

  const nextQuestions = workset.questions.map((question) =>
    question.id === currentQuestion.id ? rewrittenQuestion : question
  );

  return touchSession(
    withSafeMemory({
      ...preview,
      currentWorkset: {
        ...workset,
        questions: nextQuestions,
      },
    })
  );
}
