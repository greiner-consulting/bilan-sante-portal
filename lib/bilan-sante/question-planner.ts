import type { DimensionId, IterationNumber } from "@/lib/bilan-sante/protocol";
import {
  DIAGNOSTIC_DIMENSIONS,
  dimensionTitle,
  maxQuestionsForIteration,
} from "@/lib/bilan-sante/protocol";
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

type TrameDimensionBlueprintLite = {
  dimensionId: DimensionId;
  selectedThemes?: string[];
  inferredThemes?: string[];
};

const CANDIDATE_POOL_SIZE: Record<IterationNumber, number> = {
  1: 40,
  2: 40,
  3: 32,
};

const ABSOLUTE_MIN_SCORE: Record<IterationNumber, number> = {
  1: 28,
  2: 28,
  3: 26,
};

const EXTENSION_MIN_SCORE: Record<IterationNumber, number> = {
  1: 34,
  2: 34,
  3: 32,
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

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = normalizeText(value);
    const key = normalizeForMatch(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out;
}

function buildQuestionId(
  signal: DiagnosticSignal,
  iteration: IterationNumber,
  index: number
): string {
  return `q-${signal.id}-it${iteration}-${index}`;
}

function getAllSignals(registry: SignalRegistry): DiagnosticSignal[] {
  if ("allSignals" in registry && Array.isArray(registry.allSignals)) {
    return registry.allSignals;
  }
  if ("all" in registry && Array.isArray(registry.all)) {
    return registry.all;
  }
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
      dominantSuggestedAngle = angle;
      bestAngleScore = count;
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

  const extractedFacts = uniqueStrings(
    usable.flatMap((item) => item.extractedFacts ?? [])
  ).slice(0, 4);

  const coverage = getThemeCoverage(session, dimensionId, theme);
  const askedAngles = coverage?.askedAngles ?? [];
  const confirmedAngles = coverage?.confirmedAngles ?? [];
  const rejectedAngles = coverage?.rejectedAngles ?? [];
  const saturationScore =
    confirmedAngles.length * 22 +
    extractedFacts.length * 14 +
    (coverage?.factDensity ?? 0) * 10;

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

  for (const question of session.currentWorkset?.questions ?? []) {
    ids.add(question.signalId);
  }

  for (const insight of session.analysisMemory ?? []) {
    if (
      insight.signalId &&
      (insight.isUsableBusinessMatter ||
        insight.intent === "business_answer" ||
        insight.intent === "mixed")
    ) {
      ids.add(insight.signalId);
    }
  }

  return ids;
}

function getDimensionBlueprint(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): TrameDimensionBlueprintLite | null {
  const trame = session.trame as
    | (DiagnosticSessionAggregate["trame"] & {
        dimensionBlueprints?: TrameDimensionBlueprintLite[];
      })
    | null;

  const blueprints = trame?.dimensionBlueprints;
  if (!Array.isArray(blueprints)) return null;

  return blueprints.find((item) => Number(item.dimensionId) === Number(dimensionId)) ?? null;
}

function getRequiredThemesForDimension(dimensionId: DimensionId): string[] {
  return (
    DIAGNOSTIC_DIMENSIONS.find((item) => item.id === dimensionId)?.requiredThemes ?? []
  );
}

function getSelectedThemesForDimension(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): string[] {
  const blueprint = getDimensionBlueprint(session, dimensionId);
  const selected = Array.isArray(blueprint?.selectedThemes)
    ? blueprint.selectedThemes.map((item) => normalizeText(item)).filter(Boolean)
    : [];

  if (selected.length > 0) {
    return uniqueStrings(selected).slice(0, 3);
  }

  return getRequiredThemesForDimension(dimensionId).slice(0, 3);
}

function getInferredThemesForDimension(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): Set<string> {
  const blueprint = getDimensionBlueprint(session, dimensionId);
  const inferred = Array.isArray(blueprint?.inferredThemes)
    ? blueprint.inferredThemes.map((item) => normalizeForMatch(item)).filter(Boolean)
    : [];

  return new Set<string>(inferred);
}

function countCoveredAngle(themeMemory: ThemeMemorySummary, angle: EntryAngle): number {
  let count = 0;
  if (themeMemory.askedAngles.includes(angle)) count += 1;
  if (themeMemory.confirmedAngles.includes(angle)) count += 2;

  for (const item of themeMemory.all) {
    if (item.suggestedAngle === angle) count += 1;
  }

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

  if (sameAngleCount === 0) {
    return iteration === 1 ? 8 : 16;
  }

  if (
    wasAngleMarkedInPriorIterations({
      session,
      dimensionId,
      theme: themeMemory.theme,
      angle: signal.entryAngle,
      currentIteration: iteration,
    })
  ) {
    return iteration === 3 ? -18 : -12;
  }

  return sameAngleCount === 1 ? -2 : -8;
}

function scoreThemeContinuation(
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  if (themeMemory.usable.length === 0 && themeMemory.confirmedAngles.length === 0) {
    return 10;
  }

  if (themeMemory.saturationScore >= 78) {
    return -16;
  }

  if (themeMemory.usable.length === 1 || themeMemory.confirmedAngles.length === 1) {
    return iteration === 1 ? 6 : 12;
  }

  if (themeMemory.usable.length >= 2 || themeMemory.confirmedAngles.length >= 2) {
    return iteration === 3 ? 8 : 4;
  }

  return 0;
}

function scoreRootCauseAlignment(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary
): number {
  let score = 0;

  if (
    (themeMemory.dominantRootCauses.includes("skills") ||
      themeMemory.dominantRootCauses.includes("experience") ||
      themeMemory.dominantRootCauses.includes("decision")) &&
    signal.entryAngle === "causality"
  ) {
    score += 10;
  }

  if (
    themeMemory.dominantRootCauses.includes("arbitration") &&
    signal.entryAngle === "arbitration"
  ) {
    score += 10;
  }

  if (
    (themeMemory.dominantRootCauses.includes("pricing") ||
      themeMemory.dominantRootCauses.includes("cash")) &&
    signal.entryAngle === "economics"
  ) {
    score += 10;
  }

  if (
    themeMemory.dominantRootCauses.includes("organization") &&
    signal.entryAngle === "formalization"
  ) {
    score += 8;
  }

  if (
    themeMemory.dominantRootCauses.includes("resources") &&
    signal.entryAngle === "dependency"
  ) {
    score += 8;
  }

  return score;
}

function scoreIterationIntentFit(
  signal: DiagnosticSignal,
  iteration: IterationNumber
): number {
  let score = 0;

  if (iteration === 1) {
    if (signal.signalKind === "explicit") score += 14;
    if (signal.entryAngle === "mechanism") score += 10;
    if (signal.entryAngle === "formalization") score += 8;
    if (signal.signalKind === "absence") score -= 2;
  }

  if (iteration === 2) {
    if (signal.entryAngle === "causality") score += 18;
    if (signal.entryAngle === "arbitration") score += 14;
    if (signal.entryAngle === "dependency") score += 10;
    if (signal.entryAngle === "economics") score += 8;
  }

  if (iteration === 3) {
    if (signal.entryAngle === "formalization") score += 12;
    if (signal.entryAngle === "dependency") score += 12;
    if (signal.entryAngle === "arbitration") score += 10;
    if (signal.entryAngle === "economics") score += 6;
  }

  return score;
}

function isLowEvidenceSignal(signal: DiagnosticSignal): boolean {
  if (signal.signalKind !== "absence") return false;

  const excerpt = normalizeForMatch(signal.sourceExcerpt);
  const constat = normalizeForMatch(signal.constat);

  const genericExcerpt =
    excerpt.length < 110 ||
    excerpt.includes("aucun signal suffisamment explicite") ||
    excerpt.includes("aucun signal") ||
    excerpt.includes("no_evidence") ||
    excerpt.includes("not_enough_material");

  const genericConstat =
    constat.includes("no_evidence") ||
    constat.includes("no evidence") ||
    constat.includes("insuffisamment etaye") ||
    constat.includes("non documente") ||
    constat.includes("non documenté");

  return genericExcerpt && genericConstat;
}

function scoreLowEvidencePenalty(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  if (!isLowEvidenceSignal(signal)) return 0;

  let score = iteration === 1 ? -8 : -4;

  if (themeMemory.usable.length > 0 || themeMemory.confirmedAngles.length > 0) {
    score -= 4;
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

  return alreadyCovered ? -2 : 12;
}

function scoreThemeSaturation(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  if (themeMemory.saturationScore < 78) return 0;
  if (iteration === 3 && !themeMemory.confirmedAngles.includes(signal.entryAngle)) {
    return 6;
  }
  return -12;
}

function scoreEvidenceDensity(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  const excerptLength = normalizeText(signal.sourceExcerpt).length;
  const constatLength = normalizeText(signal.constat).length;
  let score = 0;

  if (signal.signalKind === "explicit") score += 8;
  if (excerptLength >= 120) score += 6;
  if (excerptLength >= 220) score += 6;
  if (constatLength >= 120) score += 4;
  if (themeMemory.usableFactCount > 0) score += 6;
  if (themeMemory.usableFactCount >= 2) score += 6;
  if (iteration >= 2 && themeMemory.usableFactCount > 0) score += 4;

  return score;
}

function scoreQuestionSpecificity(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  const text = normalizeForMatch(
    `${signal.constat} ${signal.managerialRisk} ${signal.sourceExcerpt}`
  );
  let score = 0;

  if (/(arbitrage|validation|decide|décide|comite|comité)/.test(text)) score += 8;
  if (/(depend|dépend|personne cle|personne clé|relais|goulot)/.test(text)) score += 8;
  if (/(marge|cash|cout|coût|rentabilite|rentabilité)/.test(text)) score += 8;
  if (/(rituel|indicateur|tableau de bord|cadre|role|rôle|procedure|procédure)/.test(text)) {
    score += 6;
  }
  if (iteration === 3 && /(moins pilote|moins piloté|hors pilotage|non suivi)/.test(text)) {
    score += 6;
  }
  if (
    themeMemory.lastQuestionText &&
    normalizeForMatch(themeMemory.lastQuestionText) === normalizeForMatch(signal.constat)
  ) {
    score -= 6;
  }

  return score;
}

function scoreThemePlanAlignment(
  signal: DiagnosticSignal,
  inferredThemes: Set<string>
): number {
  const themeKey = normalizeForMatch(signal.theme);
  return inferredThemes.has(themeKey) ? -2 : 10;
}

function scoreSignalForIteration(
  signal: DiagnosticSignal,
  iteration: IterationNumber,
  themeMemory: ThemeMemorySummary,
  alreadyUsedSignalIds: Set<string>,
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  inferredThemes: Set<string>,
  rationale: string[]
): number {
  let score = signal.criticalityScore + signal.confidenceScore;

  if (signal.signalKind === "explicit") score += 8;
  if (signal.signalKind === "absence") score -= 1;

  score += scoreIterationIntentFit(signal, iteration);

  if (alreadyUsedSignalIds.has(signal.id)) {
    score -= 28;
    rationale.push("signal déjà utilisé");
  }

  const continuation = scoreThemeContinuation(themeMemory, iteration);
  score += continuation;
  if (continuation > 8) rationale.push("thème encore à instruire");
  if (continuation < -10) rationale.push("thème déjà saturé");

  const novelty = scoreAngleNovelty(session, signal, themeMemory, dimensionId, iteration);
  score += novelty;
  if (novelty > 10) rationale.push("angle nouveau");
  if (novelty < -10) rationale.push("angle déjà couvert");

  const rootCauseAlignment = scoreRootCauseAlignment(signal, themeMemory);
  score += rootCauseAlignment;
  if (rootCauseAlignment > 0) rationale.push("alignement causes racines");

  const lowEvidencePenalty = scoreLowEvidencePenalty(signal, themeMemory, iteration);
  score += lowEvidencePenalty;
  if (lowEvidencePenalty < 0) rationale.push("signal faible");

  const mandatoryGap = scoreMandatoryAngleGap(session, signal, dimensionId, iteration);
  score += mandatoryGap;
  if (mandatoryGap > 0) rationale.push("angle obligatoire non couvert");

  const saturation = scoreThemeSaturation(signal, themeMemory, iteration);
  score += saturation;
  if (saturation < -10) rationale.push("thème saturé");

  const density = scoreEvidenceDensity(signal, themeMemory, iteration);
  score += density;
  if (density >= 12) rationale.push("matière exploitable dense");

  const specificity = scoreQuestionSpecificity(signal, themeMemory, iteration);
  score += specificity;
  if (specificity >= 10) rationale.push("mécanisme managérial spécifique");

  const themePlanAlignment = scoreThemePlanAlignment(signal, inferredThemes);
  score += themePlanAlignment;
  if (themePlanAlignment > 0) rationale.push("thème retenu");
  if (themePlanAlignment < 0) rationale.push("thème inféré");

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
  if (
    normalizeText(item.signal.sourceExcerpt).length >= 180 &&
    item.signal.signalKind === "explicit"
  ) {
    return true;
  }
  return false;
}

function maxPerThemeForIteration(iteration: IterationNumber): number {
  switch (iteration) {
    case 1:
      return 3;
    case 2:
      return 3;
    case 3:
      return 2;
    default:
      return 3;
  }
}

function distributionForAvailableThemeCount(
  iteration: IterationNumber,
  availableThemeCount: number
): number[] {
  const target = maxQuestionsForIteration(iteration);

  if (availableThemeCount >= 3) {
    return iteration === 3 ? [2, 1, 1] : [2, 2, 1];
  }

  if (availableThemeCount === 2) {
    return iteration === 3 ? [2, 2] : [3, 2];
  }

  if (availableThemeCount === 1) {
    return [target];
  }

  return [];
}

function groupCandidatesByTheme(
  scoredSignals: ScoredSignal[],
  targetThemes: string[]
): Map<string, ScoredSignal[]> {
  const map = new Map<string, ScoredSignal[]>();
  const targetThemeKeys = targetThemes.map((item) => normalizeForMatch(item));

  for (const key of targetThemeKeys) {
    map.set(key, []);
  }

  for (const item of scoredSignals) {
    const key = normalizeForMatch(item.signal.theme);
    if (!map.has(key)) continue;
    map.get(key)?.push(item);
  }

  for (const [key, values] of map.entries()) {
    map.set(
      key,
      [...values].sort((a, b) => b.score - a.score)
    );
  }

  return map;
}

function themeUsageCount(selected: ScoredSignal[], themeKey: string): number {
  return selected.filter(
    (item) => normalizeForMatch(item.signal.theme) === themeKey
  ).length;
}

function canReuseThemeInSameIteration(
  selected: ScoredSignal[],
  candidate: ScoredSignal,
  iteration: IterationNumber
): boolean {
  const candidateThemeKey = normalizeForMatch(candidate.signal.theme);
  const sameTheme = selected.filter(
    (item) => normalizeForMatch(item.signal.theme) === candidateThemeKey
  );

  const maxPerTheme = maxPerThemeForIteration(iteration);

  if (sameTheme.length === 0) return true;
  if (sameTheme.length >= maxPerTheme) return false;

  const differentAngle = sameTheme.every(
    (existing) => existing.signal.entryAngle !== candidate.signal.entryAngle
  );

  if (differentAngle) return true;

  return candidate.score >= EXTENSION_MIN_SCORE[iteration] + 4;
}

function chooseOneCandidateForTheme(params: {
  pool: ScoredSignal[];
  selected: ScoredSignal[];
  iteration: IterationNumber;
  allowWeak: boolean;
}): ScoredSignal | null {
  for (const candidate of params.pool) {
    if (params.selected.some((item) => item.signal.id === candidate.signal.id)) continue;
    if (!canReuseThemeInSameIteration(params.selected, candidate, params.iteration)) continue;

    if (
      !params.allowWeak &&
      candidate.score < ABSOLUTE_MIN_SCORE[params.iteration] &&
      !hasStrongReasonToKeep(candidate, params.iteration)
    ) {
      continue;
    }

    return candidate;
  }

  return null;
}

function seedByThemeDistribution(params: {
  scoredSignals: ScoredSignal[];
  iteration: IterationNumber;
  targetThemes: string[];
}): ScoredSignal[] {
  const selected: ScoredSignal[] = [];
  const grouped = groupCandidatesByTheme(params.scoredSignals, params.targetThemes);

  const activeThemeKeys = params.targetThemes
    .map((item) => normalizeForMatch(item))
    .filter((themeKey) => (grouped.get(themeKey) ?? []).length > 0);

  const distribution = distributionForAvailableThemeCount(
    params.iteration,
    activeThemeKeys.length
  );

  activeThemeKeys.forEach((themeKey, index) => {
    const wanted = distribution[index] ?? 0;
    const pool = grouped.get(themeKey) ?? [];
    let taken = 0;

    while (taken < wanted) {
      const next = chooseOneCandidateForTheme({
        pool,
        selected,
        iteration: params.iteration,
        allowWeak: false,
      });

      if (!next) break;
      selected.push(next);
      taken += 1;
    }
  });

  return selected;
}

function fillRemainingCapacity(params: {
  selected: ScoredSignal[];
  scoredSignals: ScoredSignal[];
  iteration: IterationNumber;
}): ScoredSignal[] {
  const maxQuestions = maxQuestionsForIteration(params.iteration);
  const out = [...params.selected];

  for (const item of params.scoredSignals) {
    if (out.length >= maxQuestions) break;
    if (out.some((existing) => existing.signal.id === item.signal.id)) continue;
    if (!canReuseThemeInSameIteration(out, item, params.iteration)) continue;

    if (
      item.score < EXTENSION_MIN_SCORE[params.iteration] &&
      !hasStrongReasonToKeep(item, params.iteration)
    ) {
      continue;
    }

    out.push(item);
  }

  return out;
}

function forceFillToTarget(params: {
  selected: ScoredSignal[];
  scoredSignals: ScoredSignal[];
  iteration: IterationNumber;
}): ScoredSignal[] {
  const maxQuestions = maxQuestionsForIteration(params.iteration);
  const out = [...params.selected];

  for (const item of params.scoredSignals) {
    if (out.length >= maxQuestions) break;
    if (out.some((existing) => existing.signal.id === item.signal.id)) continue;
    if (!canReuseThemeInSameIteration(out, item, params.iteration)) continue;
    out.push(item);
  }

  return out.slice(0, maxQuestions);
}

function selectHighQualitySignals(params: {
  scoredSignals: ScoredSignal[];
  iteration: IterationNumber;
  targetThemes: string[];
}): ScoredSignal[] {
  if (params.scoredSignals.length === 0) return [];

  const seeded = seedByThemeDistribution({
    scoredSignals: params.scoredSignals,
    iteration: params.iteration,
    targetThemes: params.targetThemes,
  });

  const completed = fillRemainingCapacity({
    selected: seeded,
    scoredSignals: params.scoredSignals,
    iteration: params.iteration,
  });

  const forced = forceFillToTarget({
    selected: completed,
    scoredSignals: params.scoredSignals,
    iteration: params.iteration,
  });

  return forced;
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
  const selectedThemes = getSelectedThemesForDimension(session, dimensionId);
  const inferredThemes = getInferredThemesForDimension(session, dimensionId);
  const allowedThemeKeys = new Set(selectedThemes.map((item) => normalizeForMatch(item)));

  const candidates: ScoredSignal[] = getAllSignals(registry)
    .filter((signal) => signal.dimensionId === dimensionId)
    .filter((signal) => {
      if (allowedThemeKeys.size === 0) return true;
      return allowedThemeKeys.has(normalizeForMatch(signal.theme));
    })
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
          inferredThemes,
          rationale
        ),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_POOL_SIZE[iteration]);

  const selected = selectHighQualitySignals({
    scoredSignals: candidates,
    iteration,
    targetThemes: selectedThemes,
  });

  const questions = await Promise.all(
    selected.map((item, index) =>
      buildStructuredQuestion(
        item.signal,
        iteration,
        index + 1,
        item.themeMemory,
        dimensionId
      )
    )
  );

  const diagnostics = candidates.map((item) => ({
    signalId: item.signal.id,
    theme: item.signal.theme,
    entryAngle: item.signal.entryAngle,
    score: item.score,
    rationale: item.rationale.length > 0 ? item.rationale : ["score composite"],
  }));

  const activeThemeKeys = new Set(
    selected.map((item) => normalizeForMatch(item.signal.theme))
  );

  const notes = [
    `Plan de dimension retenu : ${selectedThemes.join(" | ") || "aucun thème retenu"}.`,
    inferredThemes.size > 0
      ? `Thème inféré utilisé avec retenue : ${selectedThemes
          .filter((item) => inferredThemes.has(normalizeForMatch(item)))
          .join(" | ")}.`
      : "Aucun thème inféré utilisé sur cette dimension.",
    `Sélection ${questions.length} question(s) sur ${candidates.length} candidat(s).`,
    `Itération ${iteration}/3 — angles prioritaires : ${mandatoryAnglesForIteration(iteration).join(
      ", "
    )}.`,
    `Cap cible itération : ${maxQuestionsForIteration(iteration)} question(s).`,
    `Thèmes réellement alimentés dans le workset : ${activeThemeKeys.size}.`,
    `Cap max par thème sur cette itération : ${maxPerThemeForIteration(iteration)}.`,
    "Le planner vise d’abord 3 thèmes, puis bascule en remplissage contrôlé pour tenir 5/5/4 même si la matière est inégalement répartie.",
  ];

  return { questions, diagnostics, notes };
}

export async function planIterationQuestions(
  params: PlanParams
): Promise<StructuredQuestion[]> {
  return (await planIterationQuestionsWithDiagnostics(params)).questions;
}