import type { DimensionId, IterationNumber } from "@/lib/bilan-sante/protocol";
import {
  DIAGNOSTIC_DIMENSIONS,
  maxQuestionsForIteration,
} from "@/lib/bilan-sante/protocol";
import type {
  DiagnosticSessionAggregate,
  SignalRegistry,
  StructuredQuestion,
  DiagnosticSignal,
  MemoryInsight,
  PlanningDiagnostic,
} from "@/lib/bilan-sante/session-model";
import { getThemeCoverage } from "@/lib/bilan-sante/coverage-tracker";
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
  extractedFacts: string[];
  usableFactCount: number;
  askedAngles: DiagnosticSignal["entryAngle"][];
  confirmedAngles: DiagnosticSignal["entryAngle"][];
  rejectedAngles: DiagnosticSignal["entryAngle"][];
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
  1: 48,
  2: 48,
  3: 36,
};

const ABSOLUTE_MIN_SCORE: Record<IterationNumber, number> = {
  1: 22,
  2: 22,
  3: 20,
};

const EXTENSION_MIN_SCORE: Record<IterationNumber, number> = {
  1: 28,
  2: 28,
  3: 24,
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

  const extractedFacts = uniqueStrings(
    usable.flatMap((item) => item.extractedFacts ?? [])
  ).slice(0, 4);

  const coverage = getThemeCoverage(session, dimensionId, theme);
  const askedAngles = coverage?.askedAngles ?? [];
  const confirmedAngles = coverage?.confirmedAngles ?? [];
  const rejectedAngles = coverage?.rejectedAngles ?? [];

  const saturationScore =
    confirmedAngles.length * 18 +
    extractedFacts.length * 16 +
    (coverage?.factDensity ?? 0) * 10;

  return {
    theme,
    all,
    usable,
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
    | (DiagnosticSessionAggregate["trame"] & { dimensionBlueprints?: TrameDimensionBlueprintLite[] })
    | null;

  const blueprints = trame?.dimensionBlueprints;
  if (!Array.isArray(blueprints)) return null;

  return blueprints.find((item) => Number(item.dimensionId) === Number(dimensionId)) ?? null;
}

function getRequiredThemesForDimension(dimensionId: DimensionId): string[] {
  return DIAGNOSTIC_DIMENSIONS.find((item) => item.id === dimensionId)?.requiredThemes ?? [];
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
    return uniqueStrings(selected);
  }

  return getRequiredThemesForDimension(dimensionId);
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

function signalLooksLowValue(signal: DiagnosticSignal): boolean {
  const excerpt = normalizeForMatch(signal.sourceExcerpt);
  const constat = normalizeForMatch(signal.constat);

  return (
    signal.signalKind === "absence" &&
    (excerpt.length < 110 ||
      excerpt.includes("aucun signal") ||
      excerpt.includes("not_enough_material") ||
      constat.includes("insuffisamment etaye") ||
      constat.includes("insuffisamment étayé") ||
      constat.includes("absent") ||
      constat.includes("peu documente") ||
      constat.includes("peu documenté"))
  );
}

function signalLooksConcrete(signal: DiagnosticSignal): boolean {
  const text = normalizeForMatch(
    [signal.sourceExcerpt, signal.constat].join(" | ")
  );

  return (
    normalizeText(signal.sourceExcerpt).length >= 120 ||
    /(client|chantier|devis|marge|charge|effectif|encadrement|croissance|recrut|validation|arbitrage|prix|cash|rentabilite|rentabilité|planning|productivite|productivité)/.test(
      text
    )
  );
}

function signalLooksSalientManagerially(signal: DiagnosticSignal): boolean {
  const text = normalizeForMatch(
    [signal.constat, signal.sourceExcerpt, signal.probableConsequence].join(" | ")
  );

  return /(en difficulte|difficulté|difficulte|fragile|fragilite|fragilité|insuffisant|insuffisante|pas au niveau|ne tient pas|ne suit pas|blocage|derive|dérive|tension|inadéquat|inadequat|sous-dimensionne|sous-dimensionné|surdimensionne|surdimensionné|competence insuffisante|compétence insuffisante|cadre en difficulte|cadre en difficulté|cadres en difficulte|cadres en difficulté)/.test(
    text
  );
}

function signalLooksCatalogLike(signal: DiagnosticSignal): boolean {
  const constat = normalizeForMatch(signal.constat);
  const excerpt = normalizeForMatch(signal.sourceExcerpt);

  return (
    constat.includes("la trame traite explicitement le theme") ||
    constat.includes("le meilleur support trouve pour le theme") ||
    constat.includes("constitue le meilleur appui disponible") ||
    (excerpt.length < 140 && !signalLooksConcrete(signal))
  );
}

function semanticBucket(text: string): string[] {
  const normalized = normalizeForMatch(text);
  const buckets: string[] = [];

  if (/(encadrement|cadre|effectif|equipe|équipe|ressource|staffing)/.test(normalized)) {
    buckets.push("workforce");
  }
  if (/(charge|volume|montee en charge|montée en charge|croissance|seuil)/.test(normalized)) {
    buckets.push("capacity_growth");
  }
  if (/(recrut|profil|competence|compétence|renfort)/.test(normalized)) {
    buckets.push("recruitment_profiles");
  }
  if (/(arbitrage|validation|decide|décide|decision)/.test(normalized)) {
    buckets.push("decision_arbitration");
  }
  if (/(marge|cash|cout|coût|rentabilite|rentabilité)/.test(normalized)) {
    buckets.push("economics");
  }
  if (/(rituel|indicateur|formalise|formalisé|objectiv|processus|cadre)/.test(normalized)) {
    buckets.push("formalization");
  }

  return buckets.sort();
}

function signalSemanticSignature(signal: DiagnosticSignal): string {
  const tokens = semanticBucket(
    [signal.theme, signal.constat, signal.sourceExcerpt].join(" | ")
  );

  if (tokens.length === 0) {
    return normalizeForMatch(signal.theme);
  }

  return tokens.join("|");
}

function dedupeSemanticSignals(
  selected: ScoredSignal[],
  iteration: IterationNumber
): ScoredSignal[] {
  const out: ScoredSignal[] = [];
  const seen = new Map<string, ScoredSignal>();

  for (const item of selected) {
    const signature = signalSemanticSignature(item.signal);
    const existing = seen.get(signature);

    if (!existing) {
      seen.set(signature, item);
      out.push(item);
      continue;
    }

    const keepCurrent =
      item.score > existing.score ||
      (iteration === 1 &&
        signalLooksSalientManagerially(item.signal) &&
        !signalLooksSalientManagerially(existing.signal));

    if (keepCurrent) {
      const index = out.findIndex((x) => x.signal.id === existing.signal.id);
      if (index >= 0) out.splice(index, 1, item);
      seen.set(signature, item);
    }
  }

  return out;
}

function scoreIterationIntentFit(
  signal: DiagnosticSignal,
  iteration: IterationNumber
): number {
  let score = 0;

  if (iteration === 1) {
    if (signal.signalKind === "explicit") score += 14;
    if (signalLooksConcrete(signal)) score += 12;
    if (signal.signalKind === "absence") score -= 4;
  }

  if (iteration === 2) {
    if (signal.signalKind === "explicit") score += 10;
    if (signalLooksConcrete(signal)) score += 12;
  }

  if (iteration === 3) {
    if (signalLooksConcrete(signal)) score += 8;
    if (signal.signalKind === "absence") score -= 2;
  }

  return score;
}

function scoreThemeContinuation(
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  if (themeMemory.usable.length === 0 && themeMemory.confirmedAngles.length === 0) {
    return iteration === 1 ? 8 : 4;
  }

  if (themeMemory.saturationScore >= 80) return -14;

  if (themeMemory.usableFactCount === 1) {
    return iteration === 1 ? 6 : 10;
  }

  if (themeMemory.usableFactCount >= 2) {
    return iteration === 3 ? 6 : 3;
  }

  return 0;
}

function scoreNovelty(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  const sameAngleAlreadyAsked = themeMemory.askedAngles.includes(signal.entryAngle);
  const sameAngleAlreadyConfirmed = themeMemory.confirmedAngles.includes(signal.entryAngle);

  if (!sameAngleAlreadyAsked && !sameAngleAlreadyConfirmed) {
    return iteration === 1 ? 4 : 8;
  }

  if (sameAngleAlreadyConfirmed) {
    return -6;
  }

  return -2;
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
  if (themeMemory.usableFactCount >= 2) score += 4;
  if (iteration >= 2 && themeMemory.usableFactCount > 0) score += 4;

  return score;
}

function scoreLowValuePenalty(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  if (!signalLooksLowValue(signal)) return 0;

  let score = iteration === 1 ? -10 : -6;
  if (themeMemory.usableFactCount > 0) score -= 4;

  return score;
}

function scoreThemePlanAlignment(signal: DiagnosticSignal, inferredThemes: Set<string>): number {
  const themeKey = normalizeForMatch(signal.theme);
  return inferredThemes.has(themeKey) ? -1 : 8;
}

function scoreAlreadyUsedPenalty(
  signal: DiagnosticSignal,
  alreadyUsedSignalIds: Set<string>
): number {
  return alreadyUsedSignalIds.has(signal.id) ? -28 : 0;
}

function scoreSignalForIteration(
  signal: DiagnosticSignal,
  iteration: IterationNumber,
  themeMemory: ThemeMemorySummary,
  alreadyUsedSignalIds: Set<string>,
  inferredThemes: Set<string>,
  rationale: string[]
): number {
  let score = signal.criticalityScore + signal.confidenceScore;

  if (signal.signalKind === "explicit") score += 8;
  if (signal.signalKind === "absence") score -= 2;

  const usedPenalty = scoreAlreadyUsedPenalty(signal, alreadyUsedSignalIds);
  score += usedPenalty;
  if (usedPenalty < 0) rationale.push("signal déjà utilisé");

  const iterationFit = scoreIterationIntentFit(signal, iteration);
  score += iterationFit;
  if (iterationFit >= 12) rationale.push("bon support pour l'itération");

  const continuation = scoreThemeContinuation(themeMemory, iteration);
  score += continuation;
  if (continuation > 6) rationale.push("thème encore à instruire");
  if (continuation < -10) rationale.push("thème déjà saturé");

  const novelty = scoreNovelty(signal, themeMemory, iteration);
  score += novelty;
  if (novelty > 6) rationale.push("angle encore peu exploré");
  if (novelty < -4) rationale.push("angle déjà bien couvert");

  const density = scoreEvidenceDensity(signal, themeMemory, iteration);
  score += density;
  if (density >= 12) rationale.push("matière exploitable");

  const salienceBonus =
    iteration === 1 && signalLooksSalientManagerially(signal)
      ? 22
      : iteration >= 2 && signalLooksSalientManagerially(signal)
      ? 10
      : 0;
  score += salienceBonus;
  if (salienceBonus > 0) rationale.push("signal saillant métier");

  const catalogPenalty =
    iteration === 1 && signalLooksCatalogLike(signal)
      ? -18
      : signalLooksCatalogLike(signal)
      ? -8
      : 0;
  score += catalogPenalty;
  if (catalogPenalty < 0) rationale.push("support trop catalogue");

  const lowValuePenalty = scoreLowValuePenalty(signal, themeMemory, iteration);
  score += lowValuePenalty;
  if (lowValuePenalty < 0) rationale.push("support faible");

  const themePlanAlignment = scoreThemePlanAlignment(signal, inferredThemes);
  score += themePlanAlignment;
  if (themePlanAlignment > 0) rationale.push("thème retenu");

  return score;
}

async function buildStructuredQuestion(
  signal: DiagnosticSignal,
  iteration: IterationNumber,
  index: number,
  themeMemory: ThemeMemorySummary,
  dimensionId: DimensionId
): Promise<StructuredQuestion> {
  const llmQuestion = await composeQuestionWithLlm({
    dimensionId,
    dimensionTitle:
      DIAGNOSTIC_DIMENSIONS.find((item) => item.id === dimensionId)?.title ??
      `Dimension ${dimensionId}`,
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

  const fallbackQuestion =
    iteration === 1
      ? `Sur "${signal.theme}", qu'est-ce que cela veut dire concrètement aujourd'hui ?`
      : iteration === 2
      ? `Sur "${signal.theme}", qu'est-ce qu'il faut vérifier ou clarifier maintenant ?`
      : `Sur "${signal.theme}", quel point reste aujourd'hui à objectiver ou sécuriser ?`;

  return {
    id: buildQuestionId(signal, iteration, index),
    signalId: signal.id,
    theme: signal.theme,
    constat: signal.constat,
    risqueManagerial: signal.managerialRisk,
    questionOuverte: normalizeText(llmQuestion) || fallbackQuestion,
  };
}

function hasStrongReasonToKeep(item: ScoredSignal, iteration: IterationNumber): boolean {
  if (item.signal.criticalityScore >= 85) return true;
  if (item.themeMemory.usableFactCount >= 2) return true;
  if (item.signal.signalKind === "explicit" && normalizeText(item.signal.sourceExcerpt).length >= 180) {
    return true;
  }
  if (iteration >= 2 && item.themeMemory.usableFactCount >= 1) return true;
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
  if (availableThemeCount >= 3) return iteration === 3 ? [2, 1, 1] : [2, 2, 1];
  if (availableThemeCount === 2) return iteration === 3 ? [2, 2] : [3, 2];
  if (availableThemeCount === 1) return [target];
  return [];
}

function groupCandidatesByTheme(
  scoredSignals: ScoredSignal[],
  targetThemes: string[]
): Map<string, ScoredSignal[]> {
  const map = new Map<string, ScoredSignal[]>();
  const targetThemeKeys = targetThemes.map((item) => normalizeForMatch(item));
  for (const key of targetThemeKeys) map.set(key, []);
  for (const item of scoredSignals) {
    const key = normalizeForMatch(item.signal.theme);
    if (!map.has(key)) continue;
    map.get(key)?.push(item);
  }
  for (const [key, values] of map.entries()) {
    map.set(key, [...values].sort((a, b) => b.score - a.score));
  }
  return map;
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

  const differentSignal = sameTheme.every(
    (existing) => existing.signal.id !== candidate.signal.id
  );
  if (!differentSignal) return false;

  return candidate.score >= EXTENSION_MIN_SCORE[iteration];
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
    ) continue;
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
  const seenSemantic = new Set(out.map((item) => signalSemanticSignature(item.signal)));

  for (const item of params.scoredSignals) {
    if (out.length >= maxQuestions) break;
    if (out.some((existing) => existing.signal.id === item.signal.id)) continue;
    if (!canReuseThemeInSameIteration(out, item, params.iteration)) continue;

    const semanticSignature = signalSemanticSignature(item.signal);
    if (seenSemantic.has(semanticSignature)) continue;

    if (
      item.score < EXTENSION_MIN_SCORE[params.iteration] &&
      !hasStrongReasonToKeep(item, params.iteration)
    ) continue;

    out.push(item);
    seenSemantic.add(semanticSignature);
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
  const seenSemantic = new Set(out.map((item) => signalSemanticSignature(item.signal)));

  for (const item of params.scoredSignals) {
    if (out.length >= maxQuestions) break;
    if (out.some((existing) => existing.signal.id === item.signal.id)) continue;
    if (!canReuseThemeInSameIteration(out, item, params.iteration)) continue;

    const semanticSignature = signalSemanticSignature(item.signal);
    if (seenSemantic.has(semanticSignature)) continue;

    out.push(item);
    seenSemantic.add(semanticSignature);
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

  const deduped = dedupeSemanticSignals(completed, params.iteration);

  return forceFillToTarget({
    selected: deduped,
    scoredSignals: params.scoredSignals,
    iteration: params.iteration,
  });
}

function selectPriorityThemes(params: {
  scoredSignals: ScoredSignal[];
  selectedThemes: string[];
  maxThemeCount: number;
}): string[] {
  const allowedThemeSet = new Set(params.selectedThemes.map((item) => normalizeForMatch(item)));
  const bestByTheme = new Map<
    string,
    { theme: string; bestScore: number; explicitCount: number; salientCount: number }
  >();

  for (const item of params.scoredSignals) {
    const key = normalizeForMatch(item.signal.theme);
    if (allowedThemeSet.size > 0 && !allowedThemeSet.has(key)) continue;
    const current = bestByTheme.get(key);
    const explicitCount = item.signal.signalKind === "explicit" ? 1 : 0;
    const salientCount = signalLooksSalientManagerially(item.signal) ? 1 : 0;

    if (
      !current ||
      item.score > current.bestScore ||
      (item.score === current.bestScore && explicitCount > current.explicitCount) ||
      (item.score === current.bestScore &&
        explicitCount === current.explicitCount &&
        salientCount > current.salientCount)
    ) {
      bestByTheme.set(key, {
        theme: item.signal.theme,
        bestScore: item.score,
        explicitCount,
        salientCount,
      });
    }
  }

  const ranked = [...bestByTheme.values()]
    .sort((a, b) => {
      if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
      if (b.explicitCount !== a.explicitCount) return b.explicitCount - a.explicitCount;
      return b.salientCount - a.salientCount;
    })
    .slice(0, params.maxThemeCount)
    .map((item) => item.theme);

  if (ranked.length > 0) {
    return uniqueStrings(ranked);
  }

  return uniqueStrings(params.selectedThemes).slice(0, params.maxThemeCount);
}

export async function planIterationQuestionsWithDiagnostics(params: PlanParams): Promise<{
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
          inferredThemes,
          rationale
        ),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_POOL_SIZE[iteration]);

  const priorityThemes = selectPriorityThemes({
    scoredSignals: candidates,
    selectedThemes,
    maxThemeCount: 3,
  });

  const selected = selectHighQualitySignals({
    scoredSignals: candidates,
    iteration,
    targetThemes: priorityThemes,
  });

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

  const activeThemeKeys = new Set(selected.map((item) => normalizeForMatch(item.signal.theme)));

  const notes = [
    `Plan de dimension disponible : ${selectedThemes.join(" | ") || "aucun thème retenu"}.`,
    `Thèmes prioritaires pour cette itération : ${priorityThemes.join(" | ") || "aucun"}.`,
    inferredThemes.size > 0
      ? `Thèmes inférés présents dans le plan : ${selectedThemes.filter((item) => inferredThemes.has(normalizeForMatch(item))).join(" | ")}.`
      : "Aucun thème inféré utilisé sur cette dimension.",
    `Sélection ${questions.length} question(s) sur ${candidates.length} candidat(s).`,
    `Itération ${iteration}/3 — angles obligatoires suivis à titre indicatif : ${mandatoryAnglesForIteration(iteration).join(", ")}.`,
    `Cap cible itération : ${maxQuestionsForIteration(iteration)} question(s).`,
    `Thèmes réellement alimentés dans le workset : ${activeThemeKeys.size}.`,
    `Cap max par thème sur cette itération : ${maxPerThemeForIteration(iteration)}.`,
    "Le planner fait remonter d'abord les signaux saillants métier, puis déduplique les objets sémantiquement redondants.",
  ];

  return { questions, diagnostics, notes };
}

export async function planIterationQuestions(params: PlanParams): Promise<StructuredQuestion[]> {
  return (await planIterationQuestionsWithDiagnostics(params)).questions;
}