import type { DimensionId, IterationNumber } from "@/lib/bilan-sante/protocol";
import type {
  DiagnosticSessionAggregate,
  SignalRegistry,
  StructuredQuestion,
  DiagnosticSignal,
  MemoryInsight,
  EntryAngle,
  MemoryRootCauseCategory,
} from "@/lib/bilan-sante/session-model";

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
};

type ScoredSignal = {
  signal: DiagnosticSignal;
  themeMemory: ThemeMemorySummary;
  score: number;
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
  2: 36,
  3: 34,
};

const EXTENSION_MIN_SCORE: Record<IterationNumber, number> = {
  1: 48,
  2: 42,
  3: 40,
};

const EXTENSION_MAX_GAP_FROM_PREVIOUS: Record<IterationNumber, number> = {
  1: 14,
  2: 18,
  3: 18,
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
    coveredAngles: listCoveredAngles(usable.length > 0 ? usable : all),
    dominantRootCauses,
    extractedFacts,
    usableFactCount: extractedFacts.length,
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

  return count;
}

function wasAngleCoveredInPriorIterations(
  themeMemory: ThemeMemorySummary,
  angle: EntryAngle,
  currentIteration: IterationNumber
): boolean {
  if (currentIteration === 1) return false;

  return themeMemory.usable.some(
    (item) =>
      item.suggestedAngle === angle &&
      item.iteration != null &&
      item.iteration < currentIteration
  );
}

function scoreAngleNovelty(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  const sameAngleCount = countCoveredAngle(themeMemory, signal.entryAngle);

  if (themeMemory.usable.length === 0) {
    return sameAngleCount > 0 ? -4 : 0;
  }

  if (sameAngleCount === 0) {
    if (iteration === 1) return -2;
    if (iteration === 2) return 16;
    return 14;
  }

  if (sameAngleCount === 1) {
    if (iteration === 1) return -10;
    if (iteration === 2) return -2;
    return -4;
  }

  if (iteration === 1) return -18;
  if (iteration === 2) return -10;
  return -12;
}

function scoreThemeContinuation(
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  if (themeMemory.usable.length === 0) {
    if (
      themeMemory.reframing.length > 0 ||
      themeMemory.clarification.length > 0 ||
      themeMemory.challenge.length > 0
    ) {
      return iteration === 1 ? 6 : 0;
    }

    return 0;
  }

  if (themeMemory.usable.length === 1) {
    if (iteration === 1) return -12;
    if (iteration === 2) return 16;
    return 8;
  }

  if (themeMemory.usable.length === 2) {
    if (iteration === 1) return -18;
    if (iteration === 2) return 6;
    return 14;
  }

  if (iteration === 1) return -22;
  if (iteration === 2) return -6;
  return -10;
}

function scoreReframingRecovery(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  if (themeMemory.usable.length > 0) {
    return 0;
  }

  let score = 0;

  if (themeMemory.clarification.length > 0) {
    if (iteration === 1 && signal.signalKind === "explicit") {
      score += 10;
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
      signal.entryAngle === "formalization"
    ) {
      score += 12;
    } else {
      score -= 8;
    }
  }

  if (themeMemory.challenge.length > 0) {
    if (iteration === 1) {
      score += 4;
    }
    if (signal.signalKind === "absence") {
      score -= 6;
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
      score += 14;
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

function scoreRepeatedAnglePenalty(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary,
  iteration: IterationNumber
): number {
  if (iteration <= 1) return 0;

  if (!wasAngleCoveredInPriorIterations(themeMemory, signal.entryAngle, iteration)) {
    return 0;
  }

  if (iteration === 2) {
    return -24;
  }

  return -60;
}

function scoreIterationIntentFit(
  signal: DiagnosticSignal,
  iteration: IterationNumber
): number {
  let score = 0;

  if (iteration === 1) {
    if (signal.signalKind === "explicit") score += 12;
    if (signal.entryAngle === "mechanism") score += 8;
    if (signal.entryAngle === "formalization") score += 6;
    if (signal.signalKind === "absence") score -= 10;
  }

  if (iteration === 2) {
    if (signal.entryAngle === "causality") score += 20;
    if (signal.entryAngle === "arbitration") score += 12;
    if (signal.entryAngle === "dependency") score += 8;
    if (signal.signalKind === "explicit") score += 4;
  }

  if (iteration === 3) {
    if (signal.entryAngle === "formalization") score += 16;
    if (signal.entryAngle === "dependency") score += 12;
    if (signal.entryAngle === "arbitration") score += 10;
    if (signal.entryAngle === "economics") score -= 12;
    if (signal.signalKind === "absence") score += 8;
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
    score -= 6;
  }

  if (themeMemory.usable.length > 0) {
    score -= 10;
  }

  if (signal.signalKind === "absence") {
    score -= 8;
  }

  return score;
}

function scoreSignalForIteration(
  signal: DiagnosticSignal,
  iteration: IterationNumber,
  themeMemory: ThemeMemorySummary,
  alreadyUsedSignalIds: Set<string>
): number {
  let score = signal.criticalityScore + signal.confidenceScore;

  if (signal.signalKind === "explicit") score += 8;
  if (signal.signalKind === "absence") score -= 4;

  score += scoreIterationIntentFit(signal, iteration);

  if (alreadyUsedSignalIds.has(signal.id)) {
    score -= 40;
  }

  score += scoreThemeContinuation(themeMemory, iteration);
  score += scoreAngleNovelty(signal, themeMemory, iteration);
  score += scoreReframingRecovery(signal, themeMemory, iteration);
  score += scoreRootCauseAlignment(signal, themeMemory);
  score += scoreLowEvidencePenalty(signal, themeMemory, iteration);
  score += scoreRepeatedAnglePenalty(signal, themeMemory, iteration);

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

function buildRootCauseChoiceHint(
  categories: MemoryRootCauseCategory[]
): string {
  const rootCauses = uniqueStrings(categories).slice(0, 3);

  if (rootCauses.length === 0) {
    return " Est-ce surtout un sujet de compétences, d’expérience, de décisions, d’arbitrage ou d’organisation ?";
  }

  const labels = rootCauses.map((item) => {
    switch (item) {
      case "skills":
        return "compétences";
      case "experience":
        return "expérience";
      case "decision":
        return "décisions";
      case "arbitration":
        return "arbitrage";
      case "organization":
        return "organisation";
      case "resources":
        return "ressources";
      case "pricing":
        return "prix ou chiffrage";
      case "commercial":
        return "dispositif commercial";
      case "execution":
        return "exécution";
      case "quality":
        return "qualité";
      case "cash":
        return "cash ou rentabilité";
      default:
        return item;
    }
  });

  if (labels.length === 1) {
    return ` Est-ce principalement un sujet de ${labels[0]} ?`;
  }

  if (labels.length === 2) {
    return ` Est-ce surtout un sujet de ${labels[0]} ou de ${labels[1]} ?`;
  }

  return ` Est-ce surtout un sujet de ${labels[0]}, de ${labels[1]} ou de ${labels[2]} ?`;
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
    return `Reprenons simplement le thème "${signal.theme}" : qui s’en occupe réellement aujourd’hui, comment le sujet est-il piloté au quotidien, et quel problème concret observez-vous ?${factAnchor}`;
  }

  if (
    (themeMemory.reframing.length > 0 || themeMemory.mixed.length > 0) &&
    themeMemory.usable.length === 0
  ) {
    return `Sur le thème "${signal.theme}", repartons du bon angle. Dans le fonctionnement réel de l’entreprise, quel est le problème concret à regarder en priorité, qui est impliqué, et comment cela se manifeste-t-il aujourd’hui ?${factAnchor}`;
  }

  if (themeMemory.usable.length > 0) {
    return `Sur le thème "${signal.theme}", sans revenir sur ce qui est déjà acquis, quel point reste aujourd’hui le plus flou ou le moins sécurisé dans le fonctionnement réel ? Qui est impliqué et comment cela se manifeste-t-il concrètement ?${factAnchor}`;
  }

  if (signal.signalKind === "absence") {
    return `Sur le thème "${signal.theme}", la trame ne met pas en évidence de pilotage structuré. Comment ce sujet est-il réellement traité aujourd’hui dans l’entreprise, par qui, et avec quels repères de pilotage ?${factAnchor}`;
  }

  const excerpt = shorten(signal.sourceExcerpt, 220);

  if (excerpt) {
    return `Sur le thème "${signal.theme}", la trame mentionne : "${excerpt}". Concrètement, comment ce sujet est-il géré aujourd’hui dans le fonctionnement réel de l’entreprise ?${factAnchor}`;
  }

  return `Sur le thème "${signal.theme}", comment ce sujet est-il géré aujourd’hui dans le fonctionnement réel de l’entreprise ?${factAnchor}`;
}

function buildCausalityQuestion(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary
): string {
  const factAnchor = buildFactAnchor(themeMemory.extractedFacts);
  const rootCausePart = buildRootCausePromptPart(themeMemory.dominantRootCauses);
  const rootCauseChoice = buildRootCauseChoiceHint(themeMemory.dominantRootCauses);

  if (
    themeMemory.dominantSuggestedAngle === "arbitration" &&
    !wasAngleCoveredInPriorIterations(themeMemory, "arbitration", 2)
  ) {
    return `Sur "${signal.theme}", creusons la chaîne de décision : qui arbitre réellement, qui valide, où se situent les blocages, et en quoi cela explique la situation actuelle ?${factAnchor}`;
  }

  if (
    themeMemory.dominantSuggestedAngle === "economics" &&
    !wasAngleCoveredInPriorIterations(themeMemory, "economics", 2)
  ) {
    return `Sur "${signal.theme}", creusons le fond économique : en quoi la situation actuelle vient-elle du prix, du chiffrage, de la marge, du coût réel ou du niveau de rentabilité attendu ?${factAnchor}`;
  }

  if (
    themeMemory.dominantSuggestedAngle === "formalization" &&
    !wasAngleCoveredInPriorIterations(themeMemory, "formalization", 2)
  ) {
    return `Sur "${signal.theme}", qu’est-ce qui relève d’un défaut de cadre, de rôles, de méthode ou de pilotage formalisé ? Comment cela produit-il la situation observée ?${factAnchor}`;
  }

  if (
    themeMemory.dominantSuggestedAngle === "dependency" &&
    !wasAngleCoveredInPriorIterations(themeMemory, "dependency", 2)
  ) {
    return `Sur "${signal.theme}", où se situe la dépendance la plus critique aujourd’hui : une personne clé, un validateur, une ressource rare ou un point de blocage structurel ? Comment cela entretient-il la situation actuelle ?${factAnchor}`;
  }

  return `Si l’on creuse ce point sur "${signal.theme}" : ${signal.constat} Quelles sont, selon vous, les causes principales de cette situation ?${rootCausePart}${factAnchor}${rootCauseChoice}`;
}

function buildConsolidationQuestion(
  signal: DiagnosticSignal,
  themeMemory: ThemeMemorySummary
): string {
  const factAnchor = buildFactAnchor(themeMemory.extractedFacts);

  const economicsAlreadyCovered = wasAngleCoveredInPriorIterations(
    themeMemory,
    "economics",
    3
  );
  const formalizationAlreadyCovered = wasAngleCoveredInPriorIterations(
    themeMemory,
    "formalization",
    3
  );
  const arbitrationAlreadyCovered = wasAngleCoveredInPriorIterations(
    themeMemory,
    "arbitration",
    3
  );
  const dependencyAlreadyCovered = wasAngleCoveredInPriorIterations(
    themeMemory,
    "dependency",
    3
  );

  if (!formalizationAlreadyCovered) {
    return `Sur le sujet "${signal.theme}", qu’est-ce qui reste aujourd’hui insuffisamment clarifié, formalisé ou sécurisé dans les rôles, règles de fonctionnement ou responsabilités ? Et quel indicateur simple permettrait de suivre ce point ?${factAnchor}`;
  }

  if (!dependencyAlreadyCovered) {
    return `Sur le sujet "${signal.theme}", quelle dépendance reste aujourd’hui la plus pénalisante : une personne clé, un validateur, une ressource rare ou une zone sans pilotage clair ? Et comment pouvez-vous la repérer concrètement ?${factAnchor}`;
  }

  if (!arbitrationAlreadyCovered) {
    return `Sur le sujet "${signal.theme}", où la chaîne d’arbitrage reste-t-elle encore insuffisamment claire ou insuffisamment pilotée ? Et quel signal faible vous permettrait de voir la dérive plus tôt ?${factAnchor}`;
  }

  if (!economicsAlreadyCovered) {
    return `Sur le sujet "${signal.theme}", quel impact économique concret reste aujourd’hui insuffisamment suivi : marge, coût réel, rentabilité, cash ou résultat ? Et quel indicateur vous manque encore pour le piloter ?${factAnchor}`;
  }

  return `Sur le sujet "${signal.theme}", quelle zone reste aujourd’hui non pilotée ou insuffisamment objectivée ? Et quel indicateur simple permettrait de la rendre visible plus tôt ?${factAnchor}`;
}

function hasStrongReasonToKeep(
  item: ScoredSignal,
  iteration: IterationNumber
): boolean {
  const { signal, themeMemory, score } = item;

  if (signal.criticalityScore >= 85) return true;
  if (themeMemory.usableFactCount >= 2) return true;
  if (themeMemory.dominantRootCauses.length >= 2 && iteration >= 2) return true;
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

function isWeakTailCandidate(
  item: ScoredSignal,
  iteration: IterationNumber
): boolean {
  const { signal, score } = item;

  if (score < EXTENSION_MIN_SCORE[iteration] && isLowEvidenceSignal(signal)) {
    return true;
  }

  if (iteration === 1 && signal.signalKind === "absence" && score < 55) {
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

    const previousScore = selected[selected.length - 1]?.score ?? score;
    const scoreGap = previousScore - score;

    if (score < EXTENSION_MIN_SCORE[iteration]) {
      if (!hasStrongReasonToKeep(item, iteration)) {
        break;
      }
    }

    if (scoreGap > EXTENSION_MAX_GAP_FROM_PREVIOUS[iteration]) {
      if (!hasStrongReasonToKeep(item, iteration)) {
        break;
      }
    }

    if (isWeakTailCandidate(item, iteration)) {
      if (!hasStrongReasonToKeep(item, iteration)) {
        break;
      }
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

  const fallback: ScoredSignal[] = [];
  const fallbackThemes = new Set<string>();
  const fallbackSections = new Set<string>();

  for (const item of scoredSignals) {
    const normalizedTheme = normalizeText(item.signal.theme).toLowerCase();
    const sourceSection = normalizeText(item.signal.sourceSection);

    if (fallbackThemes.has(normalizedTheme)) continue;

    if (
      sourceSection &&
      fallbackSections.has(sourceSection) &&
      item.signal.signalKind === "explicit"
    ) {
      continue;
    }

    fallback.push(item);
    fallbackThemes.add(normalizedTheme);
    if (sourceSection) fallbackSections.add(sourceSection);

    if (fallback.length >= Math.min(MIN_CORE_QUESTIONS, scoredSignals.length)) {
      break;
    }
  }

  return fallback;
}

export function planIterationQuestions(params: PlanParams): StructuredQuestion[] {
  const { registry, dimensionId, iteration, session } = params;

  const alreadyUsedSignalIds = getAlreadyUsedSignalIds(session);

  const candidates: ScoredSignal[] = getAllSignals(registry)
    .filter((signal) => signal.dimensionId === dimensionId)
    .map((signal) => {
      const themeMemory = getThemeMemorySummary(session, dimensionId, signal.theme);

      return {
        signal,
        themeMemory,
        score: scoreSignalForIteration(
          signal,
          iteration,
          themeMemory,
          alreadyUsedSignalIds
        ),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_POOL_SIZE[iteration]);

  const selected = selectHighQualitySignals(candidates, iteration);

  return selected.map((item, index) =>
    buildStructuredQuestion(
      item.signal,
      iteration,
      index + 1,
      item.themeMemory
    )
  );
}