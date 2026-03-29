import type { DimensionId, IterationNumber } from "@/lib/bilan-sante/protocol";
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
import { getThemeCoverage, wasAngleMarkedInPriorIterations } from "@/lib/bilan-sante/coverage-tracker";
import { mandatoryAnglesForIteration } from "@/lib/bilan-sante/iteration-closer";

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
  reframing: MemoryInsight[];
  clarification: MemoryInsight[];
  challenge: MemoryInsight[];
  business: MemoryInsight[];
  mixed: MemoryInsight[];
  latest: MemoryInsight | null;
  latestUsable: MemoryInsight | null;
  latestReframing: MemoryInsight | null;
  latestClarification: MemoryInsight | null;
  latestChallenge: MemoryInsight | null;
  dominantSuggestedAngle: EntryAngle | null;
  coveredAngles: EntryAngle[];
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
  1: 14,
  2: 14,
  3: 14,
};

const MIN_CORE_QUESTIONS = 3;
const MAX_ITERATION_QUESTIONS = 6;

const ABSOLUTE_MIN_SCORE: Record<IterationNumber, number> = {
  1: 40,
  2: 38,
  3: 36,
};

const EXTENSION_MIN_SCORE: Record<IterationNumber, number> = {
  1: 48,
  2: 44,
  3: 42,
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
  if ("all" in registry && Array.isArray(registry.all)) {
    return registry.all;
  }

  if ("allSignals" in registry && Array.isArray(registry.allSignals)) {
    return registry.allSignals;
  }

  return [];
}

function getAnalysisMemory(
  session: DiagnosticSessionAggregate
): MemoryInsight[] {
  return session.analysisMemory ?? [];
}

function getDimensionMemory(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): MemoryInsight[] {
  return getAnalysisMemory(session).filter(
    (item) => item.dimensionId === dimensionId
  );
}

function listCoveredAngles(items: MemoryInsight[]): EntryAngle[] {
  const seen = new Set<EntryAngle>();
  const out: EntryAngle[] = [];

  for (const item of items) {
    if (!item.suggestedAngle) continue;
    if (seen.has(item.suggestedAngle)) continue;
    seen.add(item.suggestedAngle);
    out.push(item.suggestedAngle);
  }

  return out;
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
  const reframing = all.filter((item) => item.intent === "reframing");
  const clarification = all.filter(
    (item) => item.intent === "clarification_request"
  );
  const challenge = all.filter((item) => item.intent === "challenge");
  const business = all.filter((item) => item.intent === "business_answer");
  const mixed = all.filter((item) => item.intent === "mixed");

  const latest = all[all.length - 1] ?? null;
  const latestUsable = usable[usable.length - 1] ?? null;
  const latestReframing = reframing[reframing.length - 1] ?? null;
  const latestClarification = clarification[clarification.length - 1] ?? null;
  const latestChallenge = challenge[challenge.length - 1] ?? null;

  const angleCounts = new Map<EntryAngle, number>();
  for (const item of all) {
    if (!item.suggestedAngle) continue;
    angleCounts.set(
      item.suggestedAngle,
      (angleCounts.get(item.suggestedAngle) ?? 0) + 1
    );
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

  const extractedFacts = uniqueStrings(
    usable.flatMap((item) => item.extractedFacts ?? [])
  ).slice(0, 3);

  const coverage = getThemeCoverage(session, dimensionId, theme);
  const askedAngles = coverage?.askedAngles ?? [];
  const confirmedAngles = coverage?.confirmedAngles ?? [];
  const rejectedAngles = coverage?.rejectedAngles ?? [];
  const saturationScore =
    confirmedAngles.length * 24 +
    extractedFacts.length * 12 +
    (coverage?.factDensity ?? 0) * 10;

  return {
    theme,
    all,
    usable,
    reframing,
    clarification,
    challenge,
    business,
    mixed,
    latest,
    latestUsable,
    latestReframing,
    latestClarification,
    latestChallenge,
    dominantSuggestedAngle,
    coveredAngles: uniqueAngles([
      ...listCoveredAngles(usable.length > 0 ? usable : all),
      ...askedAngles,
      ...confirmedAngles,
    ]),
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

function getAlreadyUsedSignalIds(
  session: DiagnosticSessionAggregate
): Set<string> {
  const ids = new Set<string>();

  for (const question of session.currentWorkset?.questions ?? []) {
    ids.add(question.signalId);
  }

  for (const insight of getAnalysisMemory(session)) {
    const isBlockingUsage =
      insight.isUsableBusinessMatter ||
      insight.intent === "business_answer" ||
      insight.intent === "mixed";

    if (insight.signalId && isBlockingUsage) {
      ids.add(insight.signalId);
    }
  }

  return ids;
}

function countCoveredAngle(
  themeMemory: ThemeMemorySummary,
  angle: EntryAngle
): number {
  let count = 0;

  for (const item of themeMemory.all) {
    if (item.suggestedAngle === angle) {
      count += 1;
    }
  }

  if (themeMemory.askedAngles.includes(angle)) count += 1;
  if (themeMemory.confirmedAngles.includes(angle)) count += 2;

  return count;
}

function wasAngleCoveredInPriorIterations(
  session: DiagnosticSessionAggregate,
  themeMemory: ThemeMemorySummary,
  dimensionId: DimensionId,
  angle: EntryAngle,
  currentIteration: IterationNumber
): boolean {
  if (currentIteration === 1) return false;

  const fromMemory = themeMemory.usable.some(
    (item) =>
      item.suggestedAngle === angle &&
      item.iteration != null &&
      item.iteration < currentIteration
  );

  const fromCoverage = wasAngleMarkedInPriorIterations({
    session,
    dimensionId,
    theme: themeMemory.theme,
    angle,
    currentIteration,
  });

  return fromMemory || fromCoverage;
}

function scoreAngleNovelty(
  session: DiagnosticSessionAggregate,
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  dimensionId: DimensionId,
  iteration: IterationNumber
): number {
  const sameAngleCount = countCoveredAngle(themeMemory, signal.entryAngle);

  if (themeMemory.usable.length === 0 && themeMemory.confirmedAngles.length === 0) {
    return sameAngleCount > 0 ? -8 : 0;
  }

  if (sameAngleCount === 0) {
    if (iteration === 1) return 4;
    if (iteration === 2) return 18;
    return 16;
  }

  if (
    wasAngleCoveredInPriorIterations(
      session,
      themeMemory,
      dimensionId,
      signal.entryAngle,
      iteration
    )
  ) {
    return iteration === 3 ? -28 : -18;
  }

  if (sameAngleCount === 1) {
    return iteration === 1 ? -8 : -4;
  }

  return iteration === 1 ? -16 : -12;
}

function scoreThemeContinuation(
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  if (themeMemory.usable.length === 0 && themeMemory.confirmedAngles.length === 0) {
    if (
      themeMemory.reframing.length > 0 ||
      themeMemory.clarification.length > 0 ||
      themeMemory.challenge.length > 0
    ) {
      return iteration === 1 ? 6 : 2;
    }

    return 0;
  }

  if (themeMemory.saturationScore >= 60) {
    return -18;
  }

  if (themeMemory.usable.length === 1 || themeMemory.confirmedAngles.length === 1) {
    if (iteration === 1) return -8;
    if (iteration === 2) return 16;
    return 10;
  }

  if (themeMemory.usable.length === 2 || themeMemory.confirmedAngles.length >= 2) {
    if (iteration === 1) return -18;
    if (iteration === 2) return 2;
    return 8;
  }

  return -10;
}

function scoreReframingRecovery(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  if (themeMemory.usable.length > 0 || themeMemory.confirmedAngles.length > 0) {
    return 0;
  }

  let score = 0;

  if (themeMemory.clarification.length > 0) {
    if (iteration === 1 && signal.signalKind === "explicit") {
      score += 8;
    }

    if (
      signal.entryAngle === "mechanism" ||
      signal.entryAngle === "formalization"
    ) {
      score += 8;
    }
  }

  if (themeMemory.reframing.length > 0 || themeMemory.mixed.length > 0) {
    if (
      signal.entryAngle === "mechanism" ||
      signal.entryAngle === "formalization" ||
      signal.entryAngle === "causality"
    ) {
      score += 10;
    } else {
      score -= 8;
    }
  }

  return score;
}

function scoreRootCauseAlignment(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary
): number {
  let score = 0;

  if (
    themeMemory.dominantRootCauses.includes("skills") ||
    themeMemory.dominantRootCauses.includes("experience") ||
    themeMemory.dominantRootCauses.includes("decision")
  ) {
    if (signal.entryAngle === "causality") {
      score += 14;
    }
  }

  if (themeMemory.dominantRootCauses.includes("arbitration")) {
    if (signal.entryAngle === "arbitration") {
      score += 14;
    }
  }

  if (
    themeMemory.dominantRootCauses.includes("pricing") ||
    themeMemory.dominantRootCauses.includes("cash")
  ) {
    if (signal.entryAngle === "economics") {
      score += 12;
    }
  }

  if (themeMemory.dominantRootCauses.includes("organization")) {
    if (signal.entryAngle === "formalization") {
      score += 12;
    }
  }

  if (themeMemory.dominantRootCauses.includes("resources")) {
    if (signal.entryAngle === "dependency") {
      score += 10;
    }
  }

  if (themeMemory.dominantRootCauses.includes("execution")) {
    if (signal.entryAngle === "mechanism") {
      score += 8;
    }
  }

  return score;
}

function scoreIterationIntentFit(
  signal: DiagnosticSignal,
  iteration: IterationNumber
): number {
  let score = 0;

  if (iteration === 1) {
    if (signal.signalKind === "explicit") score += 10;
    if (signal.entryAngle === "mechanism") score += 10;
    if (signal.entryAngle === "formalization") score += 8;
    if (signal.signalKind === "absence") score -= 12;
  }

  if (iteration === 2) {
    if (signal.entryAngle === "causality") score += 20;
    if (signal.entryAngle === "arbitration") score += 16;
    if (signal.entryAngle === "dependency") score += 8;
  }

  if (iteration === 3) {
    if (signal.entryAngle === "formalization") score += 18;
    if (signal.entryAngle === "dependency") score += 16;
    if (signal.entryAngle === "arbitration") score += 8;
    if (signal.entryAngle === "economics") score -= 8;
    if (signal.signalKind === "absence") score += 10;
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
  iteration: IterationNumber
): number {
  let score = 0;

  if (!isLowEvidenceSignal(signal)) {
    return score;
  }

  if (iteration === 1) {
    score -= 18;
  } else {
    score -= 8;
  }

  if (themeMemory.usable.length > 0 || themeMemory.confirmedAngles.length > 0) {
    score -= 12;
  }

  if (signal.signalKind === "absence") {
    score -= 6;
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

  return alreadyCovered ? -6 : 18;
}

function scoreThemeSaturation(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  if (themeMemory.saturationScore < 60) return 0;

  if (
    iteration === 3 &&
    !themeMemory.confirmedAngles.includes(signal.entryAngle) &&
    (signal.entryAngle === "formalization" || signal.entryAngle === "dependency")
  ) {
    return 8;
  }

  return -20;
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
    score -= 40;
    rationale.push("signal déjà utilisé");
  }

  const continuation = scoreThemeContinuation(themeMemory, iteration);
  score += continuation;
  if (continuation > 0) rationale.push("thème à creuser");
  if (continuation < -10) rationale.push("thème déjà dense");

  const novelty = scoreAngleNovelty(
    session,
    signal,
    themeMemory,
    dimensionId,
    iteration
  );
  score += novelty;
  if (novelty > 10) rationale.push("angle nouveau");
  if (novelty < -12) rationale.push("angle déjà couvert");

  const reframingRecovery = scoreReframingRecovery(signal, themeMemory, iteration);
  score += reframingRecovery;
  if (reframingRecovery > 0) rationale.push("récupération après recadrage");

  const rootCauseAlignment = scoreRootCauseAlignment(signal, themeMemory);
  score += rootCauseAlignment;
  if (rootCauseAlignment > 0) rationale.push("alignement causes racines");

  const lowEvidencePenalty = scoreLowEvidencePenalty(signal, themeMemory, iteration);
  score += lowEvidencePenalty;
  if (lowEvidencePenalty < 0) rationale.push("faible étayage");

  const mandatoryGap = scoreMandatoryAngleGap(
    session,
    signal,
    dimensionId,
    iteration
  );
  score += mandatoryGap;
  if (mandatoryGap > 0) rationale.push("angle obligatoire non couvert");

  const saturation = scoreThemeSaturation(signal, themeMemory, iteration);
  score += saturation;
  if (saturation < -10) rationale.push("thème saturé");
  if (saturation > 0) rationale.push("bonne clôture possible");

  if (themeMemory.latestUsable && themeMemory.usableFactCount > 0) {
    score += 4;
  }

  return score;
}

function buildRootCausePromptPart(
  categories: MemoryRootCauseCategory[]
): string {
  const rootCauses = uniqueStrings(categories).slice(0, 3);

  if (rootCauses.length === 0) return "";

  const labels = rootCauses.map((item) => {
    switch (item) {
      case "skills":
        return "les compétences";
      case "experience":
        return "l’expérience";
      case "decision":
        return "les décisions prises";
      case "arbitration":
        return "la chaîne d’arbitrage";
      case "organization":
        return "l’organisation";
      case "resources":
        return "les ressources disponibles";
      case "pricing":
        return "le prix ou le chiffrage";
      case "commercial":
        return "le dispositif commercial";
      case "execution":
        return "l’exécution";
      case "quality":
        return "la qualité";
      case "cash":
        return "l’impact cash ou rentabilité";
      default:
        return item;
    }
  });

  if (labels.length === 1) {
    return ` Vous avez déjà orienté le sujet vers ${labels[0]}.`;
  }

  if (labels.length === 2) {
    return ` Vous avez déjà orienté le sujet vers ${labels[0]} et ${labels[1]}.`;
  }

  return ` Vous avez déjà orienté le sujet vers ${labels[0]}, ${labels[1]} et ${labels[2]}.`;
}

function buildFactAnchor(facts: string[]): string {
  const selected = uniqueStrings(facts).slice(0, 1);
  if (selected.length === 0) return "";

  return ` Vous avez indiqué notamment : "${shorten(selected[0], 160)}".`;
}

function buildStructuredQuestion(
  signal: DiagnosticSignal,
  iteration: IterationNumber,
  index: number,
  themeMemory: ThemeMemorySummary
): StructuredQuestion {
  return {
    id: buildQuestionId(signal, iteration, index),
    signalId: signal.id,
    theme: signal.theme,
    constat: signal.constat,
    risqueManagerial: signal.managerialRisk,
    questionOuverte: buildQuestionPrompt(signal, iteration, themeMemory),
  };
}

function buildQuestionPrompt(
  signal: DiagnosticSignal,
  iteration: IterationNumber,
  themeMemory: ThemeMemorySummary
): string {
  if (iteration === 1) {
    return buildExplorationQuestion(signal, themeMemory);
  }

  if (iteration === 2) {
    return buildCausalityQuestion(signal, themeMemory);
  }

  return buildConsolidationQuestion(signal, themeMemory);
}

function buildExplorationQuestion(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary
): string {
  const factAnchor = buildFactAnchor(themeMemory.extractedFacts);

  if (themeMemory.clarification.length > 0 && themeMemory.usable.length === 0) {
    return `Reprenons simplement le thème "${signal.theme}" : qui s’en occupe réellement aujourd’hui, comment le sujet est-il piloté au quotidien, où le fonctionnement se dérègle-t-il concrètement, et qu’observez-vous sur le terrain ?${factAnchor}`;
  }

  if (
    (themeMemory.reframing.length > 0 || themeMemory.mixed.length > 0) &&
    themeMemory.usable.length === 0
  ) {
    return `Sur le thème "${signal.theme}", repartons du bon angle. Dans le fonctionnement réel de l’entreprise, quel est le problème concret à regarder en priorité, qui est impliqué, et comment cela se manifeste-t-il aujourd’hui ?${factAnchor}`;
  }

  if (themeMemory.usable.length > 0 || themeMemory.confirmedAngles.length > 0) {
    return `Sur le thème "${signal.theme}", sans revenir sur ce qui est déjà acquis, quel point reste aujourd’hui le plus flou, le moins sécurisé ou le plus mal tenu dans le fonctionnement réel ? Qui est impliqué, et comment cela se voit-il concrètement ?${factAnchor}`;
  }

  if (signal.signalKind === "absence") {
    return `Sur le thème "${signal.theme}", la trame ne met pas en évidence de pilotage structuré. Comment ce sujet est-il réellement traité aujourd’hui dans l’entreprise, par qui, et selon quels repères ou règles implicites ?${factAnchor}`;
  }

  const excerpt = shorten(signal.sourceExcerpt, 220);

  if (excerpt) {
    return `Sur le thème "${signal.theme}", la trame mentionne : "${excerpt}". Concrètement, comment ce sujet fonctionne-t-il aujourd’hui dans la réalité opérationnelle, avec quels acteurs, quelles règles et quelles limites ?${factAnchor}`;
  }

  return `Sur le thème "${signal.theme}", comment ce sujet est-il géré aujourd’hui dans le fonctionnement réel de l’entreprise, avec quels acteurs et selon quelles pratiques effectives ?${factAnchor}`;
}

function buildCausalityQuestion(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary
): string {
  const factAnchor = buildFactAnchor(themeMemory.extractedFacts);
  const rootCausePart = buildRootCausePromptPart(themeMemory.dominantRootCauses);

  if (
    themeMemory.confirmedAngles.includes("arbitration") === false &&
    themeMemory.dominantSuggestedAngle === "arbitration"
  ) {
    return `Sur "${signal.theme}", creusons la chaîne de décision : qui arbitre réellement, qui valide, où se situent les blocages, et en quoi cela explique la situation actuelle ?${factAnchor}`;
  }

  if (
    themeMemory.confirmedAngles.includes("economics") === false &&
    themeMemory.dominantSuggestedAngle === "economics"
  ) {
    return `Sur "${signal.theme}", creusons le fond économique : en quoi la situation actuelle vient-elle du prix, du chiffrage, de la marge, du coût réel ou du niveau de rentabilité attendu ?${factAnchor}`;
  }

  if (
    themeMemory.confirmedAngles.includes("formalization") === false &&
    themeMemory.dominantSuggestedAngle === "formalization"
  ) {
    return `Sur "${signal.theme}", qu’est-ce qui relève d’un défaut de cadre, de rôles, de méthode ou de pilotage formalisé ? Comment cela produit-il la situation observée ?${factAnchor}`;
  }

  if (
    themeMemory.confirmedAngles.includes("dependency") === false &&
    themeMemory.dominantSuggestedAngle === "dependency"
  ) {
    return `Sur "${signal.theme}", où se situe la dépendance la plus critique aujourd’hui : une personne clé, un validateur, une ressource rare ou un point de blocage structurel ? Comment cela entretient-il la situation actuelle ?${factAnchor}`;
  }

  return `Si l’on remonte à la cause sur "${signal.theme}" : ${signal.constat} Qu’est-ce qui explique vraiment cette situation aujourd’hui, et qu’est-ce qui relève selon vous des compétences, des décisions, de l’organisation ou de la chaîne d’arbitrage ?${rootCausePart}${factAnchor}`;
}

function buildConsolidationQuestion(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary
): string {
  const factAnchor = buildFactAnchor(themeMemory.extractedFacts);

  if (!themeMemory.confirmedAngles.includes("formalization")) {
    return `Sur le sujet "${signal.theme}", qu’est-ce qui reste aujourd’hui insuffisamment clarifié, formalisé ou sécurisé dans les rôles, règles de fonctionnement ou responsabilités ? Et comment le repéreriez-vous plus tôt ?${factAnchor}`;
  }

  if (!themeMemory.confirmedAngles.includes("dependency")) {
    return `Sur le sujet "${signal.theme}", quelle dépendance reste aujourd’hui la plus pénalisante : une personne clé, un validateur, une ressource rare ou une zone sans relais fiable ? Et quel signal faible vous alerterait ?${factAnchor}`;
  }

  if (!themeMemory.confirmedAngles.includes("arbitration")) {
    return `Sur le sujet "${signal.theme}", où la chaîne d’arbitrage reste-t-elle encore insuffisamment claire, trop centralisée ou trop lente ? Et à quel moment la dérive devient-elle visible ?${factAnchor}`;
  }

  if (!themeMemory.confirmedAngles.includes("economics")) {
    return `Sur le sujet "${signal.theme}", quel impact économique concret reste aujourd’hui insuffisamment suivi : marge, coût réel, rentabilité, cash ou résultat ? Et quel indicateur simple vous manque encore pour le piloter ?${factAnchor}`;
  }

  return `Sur le sujet "${signal.theme}", quelle zone reste aujourd’hui non pilotée, insuffisamment objectivée ou trop dépendante des habitudes ? Et quel indicateur simple permettrait de la rendre visible plus tôt ?${factAnchor}`;
}

function hasStrongReasonToKeep(
  item: ScoredSignal,
  iteration: IterationNumber
): boolean {
  const { signal, themeMemory, score } = item;

  if (signal.criticalityScore >= 85) return true;
  if (themeMemory.usableFactCount >= 2) return true;
  if (themeMemory.confirmedAngles.length >= 2 && iteration >= 2) return true;
  if (
    iteration === 1 &&
    signal.signalKind === "explicit" &&
    (signal.entryAngle === "mechanism" || signal.entryAngle === "formalization") &&
    score >= EXTENSION_MIN_SCORE[iteration]
  ) {
    return true;
  }

  return false;
}

function selectHighQualitySignals(
  scoredSignals: ScoredSignal[],
  iteration: IterationNumber
): ScoredSignal[] {
  if (scoredSignals.length === 0) return [];

  const selected: ScoredSignal[] = [];
  const usedThemes = new Set<string>();
  const usedSections = new Set<string>();

  for (const item of scoredSignals) {
    const { signal, score } = item;

    const normalizedTheme = normalizeText(signal.theme).toLowerCase();
    const sourceSection = normalizeText(signal.sourceSection);

    if (usedThemes.has(normalizedTheme)) continue;

    if (
      sourceSection &&
      usedSections.has(sourceSection) &&
      signal.signalKind === "explicit"
    ) {
      continue;
    }

    if (selected.length < MIN_CORE_QUESTIONS) {
      if (score >= ABSOLUTE_MIN_SCORE[iteration]) {
        selected.push(item);
        usedThemes.add(normalizedTheme);
        if (sourceSection) usedSections.add(sourceSection);
      }
      continue;
    }

    if (score < EXTENSION_MIN_SCORE[iteration] && !hasStrongReasonToKeep(item, iteration)) {
      break;
    }

    selected.push(item);
    usedThemes.add(normalizedTheme);
    if (sourceSection) usedSections.add(sourceSection);

    if (selected.length >= MAX_ITERATION_QUESTIONS) {
      break;
    }
  }

  if (selected.length >= MIN_CORE_QUESTIONS) {
    return selected;
  }

  return scoredSignals.slice(0, Math.min(MIN_CORE_QUESTIONS, scoredSignals.length));
}

export function planIterationQuestionsWithDiagnostics(
  params: PlanParams
): {
  questions: StructuredQuestion[];
  diagnostics: PlanningDiagnostic[];
  notes: string[];
} {
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

  const questions = selected.map((item, index) =>
    buildStructuredQuestion(
      item.signal,
      iteration,
      index + 1,
      item.themeMemory
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
  ];

  return { questions, diagnostics, notes };
}

export function planIterationQuestions(params: PlanParams): StructuredQuestion[] {
  return planIterationQuestionsWithDiagnostics(params).questions;
}
