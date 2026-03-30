import type { DimensionId, IterationNumber } from "@/lib/bilan-sante/protocol";
import { maxQuestionsForIteration } from "@/lib/bilan-sante/protocol";
import type {
  DiagnosticSessionAggregate,
  SignalRegistry,
  StructuredQuestion,
  DiagnosticSignal,
  MemoryInsight,
  EntryAngle,
  MemoryRootCauseCategory,
  PlanningDiagnostic,
} from "@/lib/bilan-sante/session-model";
import {
  getThemeCoverage,
  wasAngleMarkedInPriorIterations,
} from "@/lib/bilan-sante/coverage-tracker";
import { mandatoryAnglesForIteration } from "@/lib/bilan-sante/iteration-closer";
import { composeQuestionWithLlm } from "@/lib/bilan-sante/llm-diagnostic-writer";
import { dimensionTitle } from "@/lib/bilan-sante/protocol";

type PlanParams = {
  registry: SignalRegistry;
  dimensionId: DimensionId;
  iteration: IterationNumber;
  session: DiagnosticSessionAggregate;
};

type ThemeMemorySummary = {
  theme: string;
  all: MemoryInsight[];
  usable: MemoryInsight[];
  dominantSuggestedAngle: EntryAngle | null;
  dominantRootCauses: MemoryRootCauseCategory[];
  extractedFacts: string[];
  usableFactCount: number;
  askedAngles: EntryAngle[];
  confirmedAngles: EntryAngle[];
  rejectedAngles: EntryAngle[];
  lastQuestionText: string | null;
  lastIteration: IterationNumber | null;
  saturationScore: number;
};

type ScoredSignal = {
  signal: DiagnosticSignal;
  themeMemory: ThemeMemorySummary;
  score: number;
  rationale: string[];
};

const CANDIDATE_POOL_SIZE: Record<IterationNumber, number> = {
  1: 16,
  2: 16,
  3: 14,
};

const MIN_CORE_QUESTIONS = 3;
const ABSOLUTE_MIN_SCORE: Record<IterationNumber, number> = {
  1: 38,
  2: 36,
  3: 34,
};

const EXTENSION_MIN_SCORE: Record<IterationNumber, number> = {
  1: 46,
  2: 42,
  3: 40,
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

function shorten(value: string | null | undefined, max = 240): string {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = normalizeForMatch(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function uniqueAngles(values: EntryAngle[]): EntryAngle[] {
  return [...new Set(values)];
}

function buildQuestionId(
  signal: DiagnosticSignal,
  iteration: IterationNumber,
  index: number
): string {
  return `q-${signal.id}-it${iteration}-${index}`;
}

function getAllSignals(registry: SignalRegistry): DiagnosticSignal[] {
  if ("all" in registry && Array.isArray(registry.all)) return registry.all;
  if ("allSignals" in registry && Array.isArray(registry.allSignals)) return registry.allSignals;
  return [];
}

function getDimensionMemory(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): MemoryInsight[] {
  return (session.analysisMemory ?? []).filter((item) => item.dimensionId === dimensionId);
}

function getThemeMemorySummary(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  theme: string
): ThemeMemorySummary {
  const normalizedTheme = normalizeForMatch(theme);
  const all = getDimensionMemory(session, dimensionId).filter(
    (item) => normalizeForMatch(item.theme) === normalizedTheme
  );
  const usable = all.filter((item) => item.isUsableBusinessMatter);

  const angleCounts = new Map<EntryAngle, number>();
  for (const item of all) {
    if (!item.suggestedAngle) continue;
    angleCounts.set(item.suggestedAngle, (angleCounts.get(item.suggestedAngle) ?? 0) + 1);
  }

  let dominantSuggestedAngle: EntryAngle | null = null;
  let bestAngleScore = -1;
  for (const [angle, count] of angleCounts.entries()) {
    if (count > bestAngleScore) {
      bestAngleScore = count;
      dominantSuggestedAngle = angle;
    }
  }

  const rootCauseCounts = new Map<MemoryRootCauseCategory, number>();
  for (const item of usable) {
    for (const category of item.detectedRootCauses ?? []) {
      rootCauseCounts.set(category, (rootCauseCounts.get(category) ?? 0) + 1);
    }
  }

  const dominantRootCauses = [...rootCauseCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category]) => category)
    .slice(0, 3);

  const extractedFacts = uniqueStrings(usable.flatMap((item) => item.extractedFacts ?? [])).slice(0, 3);
  const coverage = getThemeCoverage(session, dimensionId, theme);
  const askedAngles = coverage?.askedAngles ?? [];
  const confirmedAngles = coverage?.confirmedAngles ?? [];
  const rejectedAngles = coverage?.rejectedAngles ?? [];
  const saturationScore = confirmedAngles.length * 24 + extractedFacts.length * 12 + (coverage?.factDensity ?? 0) * 10;

  return {
    theme,
    all,
    usable,
    dominantSuggestedAngle,
    dominantRootCauses,
    extractedFacts,
    usableFactCount: extractedFacts.length,
    askedAngles,
    confirmedAngles,
    rejectedAngles,
    lastQuestionText: coverage?.lastQuestionText ?? null,
    lastIteration: coverage?.lastIteration ?? null,
    saturationScore,
  };
}

function getAlreadyUsedSignalIds(session: DiagnosticSessionAggregate): Set<string> {
  const ids = new Set<string>();
  for (const question of session.currentWorkset?.questions ?? []) ids.add(question.signalId);
  for (const insight of session.analysisMemory ?? []) {
    if (insight.signalId && (insight.isUsableBusinessMatter || insight.intent === "business_answer" || insight.intent === "mixed")) {
      ids.add(insight.signalId);
    }
  }
  return ids;
}

function countCoveredAngle(themeMemory: ThemeMemorySummary, angle: EntryAngle): number {
  let count = 0;
  if (themeMemory.askedAngles.includes(angle)) count += 1;
  if (themeMemory.confirmedAngles.includes(angle)) count += 2;
  for (const item of themeMemory.all) if (item.suggestedAngle === angle) count += 1;
  return count;
}

function scoreAngleNovelty(
  session: DiagnosticSessionAggregate,
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  dimensionId: DimensionId,
  iteration: IterationNumber
): number {
  const sameAngleCount = countCoveredAngle(themeMemory, signal.entryAngle);
  if (sameAngleCount === 0) return iteration === 1 ? 6 : 18;
  if (
    wasAngleMarkedInPriorIterations({
      session,
      dimensionId,
      theme: themeMemory.theme,
      angle: signal.entryAngle,
      currentIteration: iteration,
    })
  ) {
    return iteration === 3 ? -26 : -16;
  }
  return sameAngleCount === 1 ? -6 : -12;
}

function scoreThemeContinuation(themeMemory: ThemeMemorySummary, iteration: IterationNumber): number {
  if (themeMemory.usable.length === 0 && themeMemory.confirmedAngles.length === 0) return 8;
  if (themeMemory.saturationScore >= 60) return -18;
  if (themeMemory.usable.length === 1 || themeMemory.confirmedAngles.length === 1) return iteration === 1 ? -4 : 14;
  if (themeMemory.usable.length >= 2 || themeMemory.confirmedAngles.length >= 2) return iteration === 3 ? 6 : -6;
  return 0;
}

function scoreRootCauseAlignment(signal: DiagnosticSignal, themeMemory: ThemeMemorySummary): number {
  let score = 0;
  if ((themeMemory.dominantRootCauses.includes("skills") || themeMemory.dominantRootCauses.includes("experience") || themeMemory.dominantRootCauses.includes("decision")) && signal.entryAngle === "causality") score += 12;
  if (themeMemory.dominantRootCauses.includes("arbitration") && signal.entryAngle === "arbitration") score += 12;
  if ((themeMemory.dominantRootCauses.includes("pricing") || themeMemory.dominantRootCauses.includes("cash")) && signal.entryAngle === "economics") score += 10;
  if (themeMemory.dominantRootCauses.includes("organization") && signal.entryAngle === "formalization") score += 10;
  if (themeMemory.dominantRootCauses.includes("resources") && signal.entryAngle === "dependency") score += 8;
  return score;
}

function scoreIterationIntentFit(signal: DiagnosticSignal, iteration: IterationNumber): number {
  let score = 0;
  if (iteration === 1) {
    if (signal.signalKind === "explicit") score += 12;
    if (signal.entryAngle === "mechanism") score += 10;
    if (signal.entryAngle === "formalization") score += 6;
    if (signal.signalKind === "absence") score -= 8;
  }
  if (iteration === 2) {
    if (signal.entryAngle === "causality") score += 18;
    if (signal.entryAngle === "arbitration") score += 14;
    if (signal.entryAngle === "dependency") score += 8;
  }
  if (iteration === 3) {
    if (signal.entryAngle === "formalization") score += 12;
    if (signal.entryAngle === "dependency") score += 12;
    if (signal.entryAngle === "arbitration") score += 8;
    if (signal.entryAngle === "economics") score += 4;
  }
  return score;
}

function isLowEvidenceSignal(signal: DiagnosticSignal): boolean {
  const excerpt = normalizeForMatch(signal.sourceExcerpt);
  const constat = normalizeForMatch(signal.constat);
  return (
    excerpt.includes("no_evidence") ||
    excerpt.includes("no evidence") ||
    constat.includes("insuffisamment etaye") ||
    constat.includes("insuffisamment étayé") ||
    constat.includes("non documente") ||
    constat.includes("non documenté")
  );
}

function scoreLowEvidencePenalty(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber,
  dimensionId: DimensionId
): number {
  if (!isLowEvidenceSignal(signal)) return 0;

  let score = iteration === 1 ? -20 : -8;
  if (themeMemory.usable.length > 0 || themeMemory.confirmedAngles.length > 0) score -= 10;

  // thèmes particulièrement pénalisants quand traités en simple absence au rang terminal
  const normalizedTheme = normalizeForMatch(signal.theme);
  if (
    dimensionId === 1 &&
    (normalizedTheme.includes("recrutement") || normalizedTheme.includes("roles") || normalizedTheme.includes("rôles"))
  ) {
    score -= 10;
  }

  return score;
}

function scoreMandatoryAngleGap(
  session: DiagnosticSessionAggregate,
  signal: DiagnosticSignal,
  dimensionId: DimensionId,
  iteration: IterationNumber
): number {
  const mandatoryAngles = mandatoryAnglesForIteration(iteration);
  if (!mandatoryAngles.includes(signal.entryAngle)) return 0;

  const alreadyCovered = (session.themeCoverage ?? []).some(
    (item) =>
      item.dimensionId === dimensionId &&
      item.angleHistory.some(
        (mark) =>
          mark.iteration === iteration &&
          (mark.status === "asked" || mark.status === "confirmed") &&
          mark.angle === signal.entryAngle
      )
  );

  return alreadyCovered ? -4 : 16;
}

function scoreThemeSaturation(signal: DiagnosticSignal, themeMemory: ThemeMemorySummary, iteration: IterationNumber): number {
  if (themeMemory.saturationScore < 60) return 0;
  if (iteration === 3 && !themeMemory.confirmedAngles.includes(signal.entryAngle)) return 6;
  return -18;
}

function scoreSignalForIteration(
  signal: DiagnosticSignal,
  iteration: IterationNumber,
  themeMemory: ThemeMemorySummary,
  alreadyUsedSignalIds: Set<string>,
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  rationale: string[]
): number {
  let score = signal.criticalityScore + signal.confidenceScore;
  if (signal.signalKind === "explicit") score += 8;
  if (signal.signalKind === "absence") score -= 4;

  score += scoreIterationIntentFit(signal, iteration);

  if (alreadyUsedSignalIds.has(signal.id)) {
    score -= 30;
    rationale.push("signal déjà utilisé");
  }

  const continuation = scoreThemeContinuation(themeMemory, iteration);
  score += continuation;
  if (continuation > 8) rationale.push("thème encore à instruire");
  if (continuation < -10) rationale.push("thème déjà saturé");

  const novelty = scoreAngleNovelty(session, signal, themeMemory, dimensionId, iteration);
  score += novelty;
  if (novelty > 10) rationale.push("angle nouveau");
  if (novelty < -12) rationale.push("angle déjà couvert");

  const rootCauseAlignment = scoreRootCauseAlignment(signal, themeMemory);
  score += rootCauseAlignment;
  if (rootCauseAlignment > 0) rationale.push("alignement causes racines");

  const lowEvidencePenalty = scoreLowEvidencePenalty(signal, themeMemory, iteration, dimensionId);
  score += lowEvidencePenalty;
  if (lowEvidencePenalty < 0) rationale.push("signal d’absence faible");

  const mandatoryGap = scoreMandatoryAngleGap(session, signal, dimensionId, iteration);
  score += mandatoryGap;
  if (mandatoryGap > 0) rationale.push("angle obligatoire non couvert");

  const saturation = scoreThemeSaturation(signal, themeMemory, iteration);
  score += saturation;
  if (saturation < -10) rationale.push("thème saturé");

  if (themeMemory.usableFactCount > 0) score += 4;
  return score;
}

async function buildStructuredQuestion(
  signal: DiagnosticSignal,
  iteration: IterationNumber,
  index: number,
  themeMemory: ThemeMemorySummary,
  dimensionId: DimensionId
): Promise<StructuredQuestion> {
  const questionOuverte = await composeQuestionWithLlm({
    dimensionId,
    dimensionTitle: dimensionTitle(dimensionId),
    iteration,
    theme: signal.theme,
    constat: signal.constat,
    managerialRisk: signal.managerialRisk,
    entryAngle: signal.entryAngle,
    trameEvidence: signal.sourceExcerpt,
    extractedFacts: themeMemory.extractedFacts,
    coveredAngles: themeMemory.confirmedAngles,
    rejectedAngles: themeMemory.rejectedAngles,
    isAbsence: signal.signalKind === "absence",
  });

  return {
    id: buildQuestionId(signal, iteration, index),
    signalId: signal.id,
    theme: signal.theme,
    constat: signal.constat,
    risqueManagerial: signal.managerialRisk,
    questionOuverte,
  };
}

function hasStrongReasonToKeep(item: ScoredSignal, iteration: IterationNumber): boolean {
  if (item.signal.criticalityScore >= 85) return true;
  if (item.themeMemory.usableFactCount >= 2) return true;
  if (item.themeMemory.confirmedAngles.length >= 2 && iteration >= 2) return true;
  return false;
}

function selectHighQualitySignals(
  scoredSignals: ScoredSignal[],
  iteration: IterationNumber
): ScoredSignal[] {
  if (scoredSignals.length === 0) return [];

  const selected: ScoredSignal[] = [];
  const usedThemes = new Set<string>();
  const maxQuestions = maxQuestionsForIteration(iteration);

  for (const item of scoredSignals) {
    const normalizedTheme = normalizeText(item.signal.theme).toLowerCase();
    if (usedThemes.has(normalizedTheme)) continue;

    if (selected.length < MIN_CORE_QUESTIONS) {
      if (item.score >= ABSOLUTE_MIN_SCORE[iteration]) {
        selected.push(item);
        usedThemes.add(normalizedTheme);
      }
      continue;
    }

    if (item.score < EXTENSION_MIN_SCORE[iteration] && !hasStrongReasonToKeep(item, iteration)) {
      break;
    }

    selected.push(item);
    usedThemes.add(normalizedTheme);
    if (selected.length >= maxQuestions) break;
  }

  if (selected.length >= MIN_CORE_QUESTIONS) return selected;
  return scoredSignals.slice(0, Math.min(MIN_CORE_QUESTIONS, scoredSignals.length));
}

export async function planIterationQuestionsWithDiagnostics(
  params: PlanParams
): Promise<{
  questions: StructuredQuestion[];
  diagnostics: PlanningDiagnostic[];
  notes: string[];
}> {
  const { registry, dimensionId, iteration, session } = params;
  const alreadyUsedSignalIds = getAlreadyUsedSignalIds(session);

  const candidates: ScoredSignal[] = getAllSignals(registry)
    .filter((signal) => signal.dimensionId === dimensionId)
    .map((signal) => {
      const themeMemory = getThemeMemorySummary(session, dimensionId, signal.theme);
      const rationale: string[] = [];
      return {
        signal,
        themeMemory,
        rationale,
        score: scoreSignalForIteration(
          signal,
          iteration,
          themeMemory,
          alreadyUsedSignalIds,
          session,
          dimensionId,
          rationale
        ),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_POOL_SIZE[iteration]);

  const selected = selectHighQualitySignals(candidates, iteration);
  const questions = await Promise.all(
    selected.map((item, index) =>
      buildStructuredQuestion(item.signal, iteration, index + 1, item.themeMemory, dimensionId)
    )
  );

  const diagnostics = candidates.map((item) => ({
    signalId: item.signal.id,
    theme: item.signal.theme,
    entryAngle: item.signal.entryAngle,
    score: item.score,
    rationale: item.rationale.length > 0 ? item.rationale : ["score composite"],
  }));

  const notes = [
    `Sélection ${questions.length} question(s) sur ${candidates.length} candidat(s).`,
    `Itération ${iteration}/3 — angles prioritaires : ${mandatoryAnglesForIteration(iteration).join(", ")}.`,
    `Cap cible itération : ${maxQuestionsForIteration(iteration)} question(s).`,
  ];

  return { questions, diagnostics, notes };
}

export async function planIterationQuestions(
  params: PlanParams
): Promise<StructuredQuestion[]> {
  return (await planIterationQuestionsWithDiagnostics(params)).questions;
}
