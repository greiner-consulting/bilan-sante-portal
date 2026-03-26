// lib/bilan-sante/signal-extractor.ts

import {
  DIAGNOSTIC_DIMENSIONS,
  type DimensionId,
} from "@/lib/bilan-sante/protocol";
import type {
  BaseTrameSnapshot,
  DiagnosticSignal,
  SignalRegistry,
} from "@/lib/bilan-sante/session-model";
import {
  MAX_SECTION_REUSE_BEFORE_HARD_PENALTY,
  MIN_CONFIDENCE_SCORE,
  MIN_ILLUSTRATIVE_RELEVANCE_SCORE,
  MIN_RELEVANCE_SCORE,
  evidenceNatureRank,
  normalizeExtractionText,
  type EvidenceNature,
  type LlmExtractedExplicitSignal,
  type LlmSignalExtractionResponse,
  type LlmUncoveredTheme,
} from "@/lib/bilan-sante/signal-extraction-contract";
import {
  extractSignalsForDimensionWithLlm,
  llmSignalExtractionEnabled,
} from "@/lib/bilan-sante/llm-signal-extractor";

type ThemeKeywordMap = Record<string, string[]>;
type TrameSection = BaseTrameSnapshot["sections"][number];
type MissingField = BaseTrameSnapshot["missingFields"][number];

type IndexedSection = {
  section: TrameSection;
  heading: string;
  content: string;
  normalizedHeading: string;
  normalizedContent: string;
  normalizedCombined: string;
  headingTokens: string[];
  contentTokens: string[];
  combinedTokenSet: Set<string>;
  genericPenalty: number;
  textLength: number;
};

type ThemeCandidate = {
  dimensionId: DimensionId;
  theme: string;
  section: TrameSection;
  sectionHeading: string;
  excerpt: string;
  matchedKeywords: string[];
  headingHitCount: number;
  contentHitCount: number;
  genericPenalty: number;
  score: number;
  entryAngle: DiagnosticSignal["entryAngle"];
  constat: string;
};

type LlmAcceptedCandidate = {
  dimensionId: DimensionId;
  theme: string;
  section: TrameSection;
  sourceExcerpt: string;
  evidenceNature: EvidenceNature;
  entryAngle: DiagnosticSignal["entryAngle"];
  relevanceScore: number;
  confidenceScore: number;
  criticalityScore: number;
  constat: string;
  managerialRisk: string;
  probableConsequence: string;
  whyRelevant: string;
};

const MAX_EXCERPT_LENGTH = 280;
const MIN_EXPLICIT_SCORE = 32;
const STRONG_EXPLICIT_SCORE = 42;
const SECTION_REUSE_PENALTY = 18;
const GENERIC_REUSE_EXTRA_PENALTY = 10;

const GENERIC_HEADING_HINTS = [
  "commentaire",
  "commentaires",
  "observation",
  "observations",
  "synthese",
  "synthèse",
  "constat",
  "constats",
  "analyse",
  "analyses",
  "point de vigilance",
  "points de vigilance",
  "general",
  "général",
  "divers",
  "autre",
  "annexe",
  "complement",
  "complément",
  "notes",
];

const STOP_WORDS = new Set<string>([
  "des",
  "les",
  "une",
  "dans",
  "avec",
  "pour",
  "sur",
  "par",
  "aux",
  "ses",
  "ces",
  "est",
  "sont",
  "pas",
  "plus",
  "moins",
  "entre",
  "sans",
  "sous",
  "vers",
  "cela",
  "tout",
  "toute",
  "tous",
  "toutes",
  "etre",
  "être",
  "leurs",
  "leur",
  "dont",
]);

const KEYWORDS_BY_DIMENSION: Record<DimensionId, ThemeKeywordMap> = {
  1: {
    "qualité et adéquation des équipes": [
      "équipe",
      "compétence",
      "profil",
      "niveau",
      "encadrement",
      "expérience",
      "seniorité",
      "formation",
    ],
    "ressources vs charge": [
      "charge",
      "capacité",
      "ressources",
      "sous-effectif",
      "surcharge",
      "planning",
      "disponibilité",
    ],
    "turnover absentéisme stabilité": [
      "turnover",
      "absentéisme",
      "stabilité",
      "départ",
      "fidélisation",
      "rotation",
    ],
    "recrutement et intégration": [
      "recrutement",
      "recruter",
      "intégration",
      "onboarding",
      "embauche",
    ],
    "clarté des rôles": [
      "rôle",
      "responsabilité",
      "organigramme",
      "périmètre",
      "délégation",
      "poste",
    ],
  },
  2: {
    "stratégie commerciale": [
      "stratégie commerciale",
      "ciblage",
      "segmentation",
      "marché",
      "positionnement",
      "prospection",
      "offre",
    ],
    "portage managérial et déploiement réel": [
      "animation commerciale",
      "déploiement",
      "portage",
      "management commercial",
      "pilotage commercial",
      "plan d'action",
    ],
    "indicateurs funnel / taux de succès": [
      "pipeline",
      "funnel",
      "conversion",
      "taux de succès",
      "taux de transformation",
      "opportunité",
      "devis gagné",
    ],
    "capacité à générer une croissance rentable": [
      "croissance",
      "rentable",
      "rentabilité commerciale",
      "développement rentable",
      "marge commerciale",
    ],
  },
  3: {
    "construction du prix et hypothèses": [
      "prix",
      "tarif",
      "devis",
      "hypothèse",
      "chiffrage",
      "tarification",
      "remise",
    ],
    "délégation et arbitrage": [
      "arbitrage",
      "validation",
      "délégation",
      "escalade",
      "décision",
      "autorisation",
    ],
    "fiabilité du chiffrage": [
      "fiabilité",
      "écart",
      "coût réel",
      "dérive",
      "chiffrage",
      "sous-chiffrage",
      "surcoût",
    ],
    "taux de succès et critères": [
      "taux de succès",
      "critère",
      "go / no go",
      "go/no go",
      "sélection",
      "qualification",
    ],
    "maîtrise des écarts prix vendu / coût réel": [
      "écart",
      "coût réel",
      "prix vendu",
      "marge",
      "dérive",
      "rentabilité",
    ],
  },
  4: {
    "sécurité qualité performance économique": [
      "sécurité",
      "qualité",
      "performance",
      "non-qualité",
      "incident",
      "accident",
      "conformité",
    ],
    "indicateurs et rituels managériaux": [
      "indicateur",
      "rituel",
      "pilotage",
      "revue",
      "tableau de bord",
      "kpi",
    ],
    "productivité et gestion des effectifs": [
      "productivité",
      "effectif",
      "capacité",
      "charge",
      "planning",
      "rendement",
    ],
    "pilotage cash résultat marges": [
      "cash",
      "trésorerie",
      "résultat",
      "marge",
      "rentabilité",
      "ebitda",
    ],
  },
};

const ENTRY_ANGLE_HINTS: Record<DiagnosticSignal["entryAngle"], string[]> = {
  causality: [
    "parce que",
    "cause",
    "causes",
    "origine",
    "origines",
    "explique",
    "explication",
    "lié à",
    "liée à",
    "du fait de",
    "en raison de",
    "manque de",
    "défaut de",
    "erreur",
    "mauvaise décision",
    "mauvais choix",
    "compétence",
    "expérience",
  ],
  arbitration: [
    "qui décide",
    "décide",
    "décision",
    "validation",
    "valider",
    "arbitrage",
    "autorisation",
    "comité",
    "escalade",
    "signature",
  ],
  economics: [
    "coût",
    "coûts",
    "marge",
    "cash",
    "trésorerie",
    "résultat",
    "rentabilité",
    "prix",
    "impact économique",
    "budget",
  ],
  formalization: [
    "procédure",
    "processus",
    "rituel",
    "revue",
    "formalis",
    "cadre",
    "tableau de bord",
    "indicateur",
    "standard",
    "méthode",
  ],
  dependency: [
    "dépend",
    "dépendance",
    "personne clé",
    "personnes clés",
    "clé",
    "seul",
    "unique",
    "indispensable",
    "blocage",
    "goulot",
  ],
  mechanism: [],
};

function normalizeText(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const key = normalizeText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function countOccurrences(haystack: string, needle: string): number {
  if (!haystack || !needle) return 0;

  let count = 0;
  let start = 0;

  while (start < haystack.length) {
    const index = haystack.indexOf(needle, start);
    if (index === -1) break;
    count += 1;
    start = index + needle.length;
  }

  return count;
}

function findAllPositions(haystack: string, needle: string): number[] {
  if (!haystack || !needle) return [];

  const positions: number[] = [];
  let start = 0;

  while (start < haystack.length) {
    const index = haystack.indexOf(needle, start);
    if (index === -1) break;
    positions.push(index);
    start = index + needle.length;
  }

  return positions;
}

function humanizeList(values: string[]): string {
  const items = uniqueStrings(values).slice(0, 3);

  if (items.length === 0) return "des éléments de pilotage à préciser";
  if (items.length === 1) return `"${items[0]}"`;
  if (items.length === 2) return `"${items[0]}" et "${items[1]}"`;

  return `"${items[0]}", "${items[1]}" et "${items[2]}"`;
}

function makeSignalId(
  dimensionId: DimensionId,
  theme: string,
  source: string,
  index: number
): string {
  const slug = `${theme}-${source}-${index}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);

  return `sig-d${dimensionId}-${slug}`;
}

function buildGenericPenalty(
  headingTokens: string[],
  contentTokens: string[],
  heading: string
): number {
  const normalizedHeading = normalizeText(heading);
  let penalty = 0;

  if (
    GENERIC_HEADING_HINTS.some((hint) =>
      normalizedHeading.includes(normalizeText(hint))
    )
  ) {
    penalty += 12;
  }

  if (headingTokens.length <= 2) penalty += 4;
  if (contentTokens.length < 25) penalty += 8;
  if (contentTokens.length < 12) penalty += 6;
  if (normalizedHeading.length < 12) penalty += 4;

  return Math.min(penalty, 24);
}

function indexSections(snapshot: BaseTrameSnapshot): IndexedSection[] {
  return snapshot.sections.map((section) => {
    const heading = String(section.heading ?? "").replace(/\s+/g, " ").trim();
    const content = String(section.content ?? "").replace(/\s+/g, " ").trim();

    const normalizedHeading = normalizeText(heading);
    const normalizedContent = normalizeText(content);
    const normalizedCombined = `${normalizedHeading}\n${normalizedContent}`.trim();

    const headingTokens = tokenize(heading);
    const contentTokens = tokenize(content);
    const combinedTokenSet = new Set<string>([...headingTokens, ...contentTokens]);

    return {
      section,
      heading,
      content,
      normalizedHeading,
      normalizedContent,
      normalizedCombined,
      headingTokens,
      contentTokens,
      combinedTokenSet,
      genericPenalty: buildGenericPenalty(headingTokens, contentTokens, heading),
      textLength: content.length,
    };
  });
}

function scoreKeywordProximity(
  normalizedContent: string,
  normalizedKeywords: string[]
): number {
  const positions = normalizedKeywords.flatMap((keyword) =>
    findAllPositions(normalizedContent, keyword).slice(0, 2)
  );

  if (positions.length < 2) return 0;

  positions.sort((a, b) => a - b);

  let minGap = Number.POSITIVE_INFINITY;

  for (let i = 1; i < positions.length; i += 1) {
    minGap = Math.min(minGap, positions[i] - positions[i - 1]);
  }

  if (minGap <= 80) return 14;
  if (minGap <= 160) return 10;
  if (minGap <= 280) return 6;

  return 0;
}

function findExcerptAnchor(
  content: string,
  theme: string,
  matchedKeywords: string[]
): number | null {
  const lowered = content.toLowerCase();

  const candidates = [theme, ...matchedKeywords]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const candidate of candidates) {
    const index = lowered.indexOf(candidate.toLowerCase());
    if (index >= 0) return index;
  }

  return null;
}

function trimSnippet(text: string, start: number, end: number): string {
  let safeStart = Math.max(0, start);
  let safeEnd = Math.min(text.length, end);

  while (safeStart > 0 && text[safeStart] !== " ") {
    safeStart -= 1;
  }

  while (safeEnd < text.length && text[safeEnd] !== " ") {
    safeEnd += 1;
  }

  let snippet = text.slice(safeStart, safeEnd).trim();

  if (snippet.length > MAX_EXCERPT_LENGTH) {
    snippet = `${snippet.slice(0, MAX_EXCERPT_LENGTH - 1).trim()}…`;
  }

  if (safeStart > 0 && !snippet.startsWith("…")) {
    snippet = `…${snippet}`;
  }

  if (safeEnd < text.length && !snippet.endsWith("…")) {
    snippet = `${snippet}…`;
  }

  return snippet;
}

function buildContextExcerpt(
  content: string,
  theme: string,
  matchedKeywords: string[]
): string {
  const clean = String(content ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";

  const anchor = findExcerptAnchor(clean, theme, matchedKeywords);

  if (anchor === null) {
    return clean.length <= MAX_EXCERPT_LENGTH
      ? clean
      : `${clean.slice(0, MAX_EXCERPT_LENGTH - 1).trim()}…`;
  }

  const start = anchor - 100;
  const end = anchor + 180;

  return trimSnippet(clean, start, end);
}

function pickEntryAngle(
  theme: string,
  sectionHeading: string,
  excerpt: string,
  matchedKeywords: string[]
): DiagnosticSignal["entryAngle"] {
  const text = normalizeText(
    [theme, sectionHeading, excerpt, ...matchedKeywords].join(" | ")
  );

  const scoreByAngle = (
    Object.keys(ENTRY_ANGLE_HINTS) as DiagnosticSignal["entryAngle"][]
  ).map((angle) => {
    const hits = ENTRY_ANGLE_HINTS[angle].reduce((sum, hint) => {
      return sum + (text.includes(normalizeText(hint)) ? 1 : 0);
    }, 0);

    return { angle, hits };
  });

  scoreByAngle.sort((a, b) => b.hits - a.hits);

  if (scoreByAngle[0] && scoreByAngle[0].hits > 0) {
    return scoreByAngle[0].angle;
  }

  return "mechanism";
}

function buildExplicitConstat(params: {
  theme: string;
  sectionHeading: string;
  matchedKeywords: string[];
  headingHitCount: number;
}): string {
  const { theme, sectionHeading, matchedKeywords, headingHitCount } = params;
  const support = humanizeList(matchedKeywords);

  if (headingHitCount > 0) {
    return `La trame traite explicitement le thème "${theme}" dans la section "${sectionHeading}", avec un appui textuel sur ${support}.`;
  }

  if (matchedKeywords.length > 0) {
    return `Le meilleur support trouvé pour le thème "${theme}" se situe dans la section "${sectionHeading}", avec une matière reliée à ${support}.`;
  }

  return `La section "${sectionHeading}" constitue le meilleur appui disponible pour instruire le thème "${theme}".`;
}

function buildManagerialRisk(
  theme: string,
  isAbsence: boolean,
  entryAngle?: DiagnosticSignal["entryAngle"]
): string {
  if (isAbsence) {
    return `Le thème "${theme}" apparaît non suivi ou non documenté, ce qui expose l’entreprise à un pilotage managérial insuffisamment fondé.`;
  }

  switch (entryAngle) {
    case "causality":
      return `Le signal rattaché au thème "${theme}" suggère une cause racine non traitée ou insuffisamment nommée dans le pilotage.`;
    case "arbitration":
      return `Le signal rattaché au thème "${theme}" suggère une chaîne d’arbitrage ou de décision insuffisamment clarifiée.`;
    case "dependency":
      return `Le signal rattaché au thème "${theme}" suggère une dépendance excessive à des personnes, relais ou séquences critiques.`;
    case "economics":
      return `Le signal rattaché au thème "${theme}" suggère des décisions insuffisamment reliées à l’impact économique réel.`;
    case "formalization":
      return `Le signal rattaché au thème "${theme}" suggère un cadre de pilotage ou des pratiques insuffisamment formalisés.`;
    default:
      return `Le signal rattaché au thème "${theme}" suggère un risque de pilotage incomplet, de dépendance excessive ou d’arbitrage insuffisamment maîtrisé.`;
  }
}

function buildProbableConsequence(theme: string): string {
  const lower = theme.toLowerCase();

  if (lower.includes("prix") || lower.includes("chiffrage")) {
    return "Probable dérive de marge, décisions commerciales fragiles ou perte de rentabilité.";
  }

  if (lower.includes("commercial") || lower.includes("croissance")) {
    return "Probable inefficacité commerciale, croissance non rentable ou visibilité insuffisante sur le pipeline.";
  }

  if (
    lower.includes("cash") ||
    lower.includes("marge") ||
    lower.includes("résultat")
  ) {
    return "Probable dégradation du cash, du résultat ou de la visibilité économique.";
  }

  if (
    lower.includes("rôle") ||
    lower.includes("équipe") ||
    lower.includes("recrutement")
  ) {
    return "Probables reprises managériales, flou de responsabilités ou fragilité d’exécution.";
  }

  return "Probable dégradation de l’exécution, de la coordination ou de la robustesse de pilotage.";
}

function scoreConfidenceFromCandidate(candidate: ThemeCandidate): number {
  const raw =
    48 +
    Math.round(candidate.score / 2) +
    candidate.matchedKeywords.length * 3 +
    candidate.headingHitCount * 4 -
    Math.round(candidate.genericPenalty / 2);

  return clamp(raw, 55, 94);
}

function scoreCriticality(
  theme: string,
  isAbsence: boolean,
  entryAngle?: DiagnosticSignal["entryAngle"]
): number {
  const lower = theme.toLowerCase();

  let base = 72;

  if (isAbsence) base = 78;
  if (
    lower.includes("cash") ||
    lower.includes("marge") ||
    lower.includes("prix")
  ) {
    base = 90;
  }
  if (
    lower.includes("rôle") ||
    lower.includes("équipe") ||
    lower.includes("sécurité")
  ) {
    base = 84;
  }

  if (!isAbsence && (entryAngle === "economics" || entryAngle === "causality")) {
    base += 4;
  }

  return clamp(base, 60, 94);
}

function overlapCount(tokens: string[], tokenSet: Set<string>): number {
  let count = 0;

  for (const token of tokens) {
    if (tokenSet.has(token)) count += 1;
  }

  return count;
}

function buildThemeCandidate(params: {
  dimensionId: DimensionId;
  theme: string;
  keywords: string[];
  indexedSection: IndexedSection;
}): ThemeCandidate | null {
  const { dimensionId, theme, keywords, indexedSection } = params;

  const normalizedTheme = normalizeText(theme);
  const normalizedKeywords = keywords.map((keyword) => normalizeText(keyword));
  const themeTokens = tokenize(theme);

  const matchedKeywords = keywords.filter((keyword, index) => {
    const normalizedKeyword = normalizedKeywords[index];
    return indexedSection.normalizedCombined.includes(normalizedKeyword);
  });

  const headingHitCount = normalizedKeywords.reduce((sum, keyword) => {
    return sum + (indexedSection.normalizedHeading.includes(keyword) ? 1 : 0);
  }, 0);

  const contentHitCount = normalizedKeywords.reduce((sum, keyword) => {
    return sum + Math.min(2, countOccurrences(indexedSection.normalizedContent, keyword));
  }, 0);

  const exactHeadingTheme = indexedSection.normalizedHeading.includes(normalizedTheme);
  const exactContentTheme = indexedSection.normalizedContent.includes(normalizedTheme);
  const tokenOverlap = overlapCount(themeTokens, indexedSection.combinedTokenSet);

  if (
    !exactHeadingTheme &&
    !exactContentTheme &&
    matchedKeywords.length === 0 &&
    tokenOverlap < 2
  ) {
    return null;
  }

  let score = 0;

  score += Math.min(matchedKeywords.length, 4) * 12;
  score += Math.min(headingHitCount, 3) * 14;
  score += Math.min(contentHitCount, 5) * 7;
  score += Math.min(tokenOverlap, 4) * 5;
  score += exactHeadingTheme ? 24 : 0;
  score += exactContentTheme ? 16 : 0;
  score += scoreKeywordProximity(indexedSection.normalizedContent, normalizedKeywords);

  if (indexedSection.textLength >= 140) score += 4;
  if (indexedSection.textLength >= 260) score += 3;

  score -= indexedSection.genericPenalty;

  if (headingHitCount === 0 && matchedKeywords.length === 1 && tokenOverlap < 2) {
    score -= 10;
  }

  if (score < 20) {
    return null;
  }

  const excerpt = buildContextExcerpt(indexedSection.content, theme, matchedKeywords);
  const entryAngle = pickEntryAngle(
    theme,
    indexedSection.heading,
    excerpt,
    matchedKeywords
  );
  const constat = buildExplicitConstat({
    theme,
    sectionHeading: indexedSection.heading,
    matchedKeywords,
    headingHitCount,
  });

  return {
    dimensionId,
    theme,
    section: indexedSection.section,
    sectionHeading: indexedSection.heading,
    excerpt,
    matchedKeywords: uniqueStrings(matchedKeywords),
    headingHitCount,
    contentHitCount,
    genericPenalty: indexedSection.genericPenalty,
    score,
    entryAngle,
    constat,
  };
}

function candidateDiscriminationScore(candidates: ThemeCandidate[]): number {
  if (candidates.length === 0) return Number.NEGATIVE_INFINITY;

  const best = candidates[0].score;
  const second = candidates[1]?.score ?? 0;
  const spread = best - second;
  const scarcityBonus = Math.max(0, 4 - candidates.length) * 6;

  return spread + scarcityBonus + best;
}

function adjustedCandidateScore(
  candidate: ThemeCandidate,
  usageBySection: Map<string, number>
): number {
  const usageCount = usageBySection.get(candidate.section.id) ?? 0;

  if (usageCount === 0) return candidate.score;

  let penalty = usageCount * SECTION_REUSE_PENALTY;
  penalty += candidate.genericPenalty + GENERIC_REUSE_EXTRA_PENALTY;

  if (candidate.headingHitCount === 0) {
    penalty += 6;
  }

  return candidate.score - penalty;
}

function selectCandidateForTheme(
  candidates: ThemeCandidate[],
  usageBySection: Map<string, number>
): ThemeCandidate | null {
  let selected: ThemeCandidate | null = null;
  let selectedAdjustedScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const adjusted = adjustedCandidateScore(candidate, usageBySection);

    if (adjusted > selectedAdjustedScore) {
      selected = candidate;
      selectedAdjustedScore = adjusted;
    }
  }

  if (selected && selectedAdjustedScore >= MIN_EXPLICIT_SCORE) {
    return selected;
  }

  const strongFallback = candidates.find(
    (candidate) => candidate.score >= STRONG_EXPLICIT_SCORE
  );
  return strongFallback ?? null;
}

function buildExplicitSignalsDeterministic(snapshot: BaseTrameSnapshot): DiagnosticSignal[] {
  const signals: DiagnosticSignal[] = [];
  const indexedSections = indexSections(snapshot);
  let runningIndex = 1;

  for (const dimension of DIAGNOSTIC_DIMENSIONS) {
    const themeMap = KEYWORDS_BY_DIMENSION[dimension.id];

    const themeBuckets = Object.entries(themeMap)
      .map(([theme, keywords]) => {
        const candidates = indexedSections
          .map((indexedSection) =>
            buildThemeCandidate({
              dimensionId: dimension.id,
              theme,
              keywords,
              indexedSection,
            })
          )
          .filter((candidate): candidate is ThemeCandidate => candidate !== null)
          .sort((a, b) => b.score - a.score);

        return { theme, candidates };
      })
      .filter((bucket) => bucket.candidates.length > 0)
      .sort(
        (a, b) =>
          candidateDiscriminationScore(b.candidates) -
          candidateDiscriminationScore(a.candidates)
      );

    const usageBySection = new Map<string, number>();

    for (const bucket of themeBuckets) {
      const selected = selectCandidateForTheme(bucket.candidates, usageBySection);
      if (!selected) continue;

      usageBySection.set(
        selected.section.id,
        (usageBySection.get(selected.section.id) ?? 0) + 1
      );

      signals.push({
        id: makeSignalId(dimension.id, bucket.theme, selected.section.id, runningIndex++),
        dimensionId: dimension.id,
        theme: bucket.theme,
        signalKind: "explicit",
        sourceType: "trame",
        sourceSection: selected.section.id,
        sourceExcerpt: selected.excerpt || "",
        constat: selected.constat,
        managerialRisk: buildManagerialRisk(bucket.theme, false, selected.entryAngle),
        probableConsequence: buildProbableConsequence(bucket.theme),
        entryAngle: selected.entryAngle,
        confidenceScore: scoreConfidenceFromCandidate(selected),
        criticalityScore: scoreCriticality(bucket.theme, false, selected.entryAngle),
      });
    }
  }

  return dedupeSignals(signals);
}

function scoreMissingFieldHit(field: MissingField, theme: string): number {
  const themeTokens = tokenize(theme);
  const haystack = normalizeText(`${field.label ?? ""} ${field.sourceText ?? ""}`);

  let score = 0;

  if (haystack.includes(normalizeText(theme))) {
    score += 20;
  }

  for (const token of themeTokens) {
    if (haystack.includes(token)) {
      score += token.length >= 6 ? 6 : 4;
    }
  }

  return score;
}

function findBestMissingFieldHit(
  snapshot: BaseTrameSnapshot,
  dimensionId: DimensionId,
  theme: string
): MissingField | undefined {
  const candidates = snapshot.missingFields
    .filter((field) => field.dimensionId === dimensionId)
    .map((field) => ({
      field,
      score: scoreMissingFieldHit(field, theme),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.field;
}

function buildAbsenceSignals(
  snapshot: BaseTrameSnapshot,
  explicitSignals: DiagnosticSignal[],
  llmUncovered = new Map<
    string,
    {
      reason: LlmUncoveredTheme["reason"];
      whyMissing: string;
      confidenceScore: number;
    }
  >()
): DiagnosticSignal[] {
  const results: DiagnosticSignal[] = [];
  let runningIndex = 1;

  for (const dimension of DIAGNOSTIC_DIMENSIONS) {
    for (const theme of dimension.requiredThemes) {
      const alreadyCovered = explicitSignals.some(
        (signal) =>
          signal.dimensionId === dimension.id &&
          normalizeText(signal.theme) === normalizeText(theme)
      );

      if (alreadyCovered) {
        continue;
      }

      const missingFieldHit = findBestMissingFieldHit(snapshot, dimension.id, theme);
      const llmMissing = llmUncovered.get(`${dimension.id}|${normalizeText(theme)}`);

      const sourceExcerpt =
        normalizeExtractionText(llmMissing?.whyMissing) ||
        normalizeExtractionText(missingFieldHit?.sourceText) ||
        `Aucun signal suffisamment explicite trouvé dans la trame sur le thème "${theme}".`;

      const constat = llmMissing
        ? `Le thème "${theme}" ressort comme insuffisamment étayé dans la trame (${llmMissing.reason}).`
        : missingFieldHit
        ? `Le thème "${theme}" ressort comme absent, incomplet ou insuffisamment documenté dans la trame, notamment via le champ "${missingFieldHit.label}".`
        : `Le thème "${theme}" est absent, peu documenté ou insuffisamment suivi dans la trame.`;

      results.push({
        id: makeSignalId(dimension.id, theme, "absence", runningIndex++),
        dimensionId: dimension.id,
        theme,
        signalKind: "absence",
        sourceType: "trame",
        sourceSection: null,
        sourceExcerpt: sourceExcerpt || "",
        constat,
        managerialRisk: buildManagerialRisk(theme, true),
        probableConsequence: buildProbableConsequence(theme),
        entryAngle: "formalization",
        confidenceScore: clamp(
          llmMissing?.confidenceScore ??
            (missingFieldHit ? 82 : 78),
          55,
          92
        ),
        criticalityScore: scoreCriticality(theme, true),
      });
    }
  }

  return dedupeSignals(results);
}

function dedupeSignals(signals: DiagnosticSignal[]): DiagnosticSignal[] {
  const seen = new Set<string>();
  const out: DiagnosticSignal[] = [];

  for (const signal of signals) {
    const key = [
      signal.dimensionId,
      normalizeText(signal.theme),
      signal.signalKind,
      String(signal.sourceSection ?? "none").toLowerCase(),
      normalizeText(String(signal.sourceExcerpt ?? "")),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(signal);
  }

  return out;
}

function buildEmptyRegistry(allSignals: DiagnosticSignal[]): SignalRegistry {
  return {
    all: allSignals,
    allSignals,
    byDimension: {
      d1: allSignals.filter((signal) => signal.dimensionId === 1),
      d2: allSignals.filter((signal) => signal.dimensionId === 2),
      d3: allSignals.filter((signal) => signal.dimensionId === 3),
      d4: allSignals.filter((signal) => signal.dimensionId === 4),
    },
  };
}

function findSectionById(
  snapshot: BaseTrameSnapshot,
  sectionId: string
): TrameSection | undefined {
  return snapshot.sections.find((section) => String(section.id ?? "").trim() === sectionId);
}

function isAcceptableLlmSignal(item: LlmExtractedExplicitSignal): boolean {
  if (item.evidenceNature === "anecdotal") return false;
  if (item.relevanceScore < MIN_RELEVANCE_SCORE) return false;
  if (item.confidenceScore < MIN_CONFIDENCE_SCORE) return false;

  if (
    item.evidenceNature === "illustrative" &&
    item.relevanceScore < MIN_ILLUSTRATIVE_RELEVANCE_SCORE
  ) {
    return false;
  }

  return true;
}

function toAcceptedLlmCandidate(
  snapshot: BaseTrameSnapshot,
  dimensionId: DimensionId,
  item: LlmExtractedExplicitSignal
): LlmAcceptedCandidate | null {
  const section = findSectionById(snapshot, item.sourceSectionId);
  if (!section) return null;
  if (!isAcceptableLlmSignal(item)) return null;

  return {
    dimensionId,
    theme: item.theme,
    section,
    sourceExcerpt: item.sourceExcerpt,
    evidenceNature: item.evidenceNature,
    entryAngle: item.entryAngle,
    relevanceScore: item.relevanceScore,
    confidenceScore: item.confidenceScore,
    criticalityScore: item.criticalityScore,
    constat: item.constat,
    managerialRisk: item.managerialRisk,
    probableConsequence: item.probableConsequence,
    whyRelevant: item.whyRelevant,
  };
}

function llmCandidateBaseScore(candidate: LlmAcceptedCandidate): number {
  return (
    evidenceNatureRank(candidate.evidenceNature) * 1000 +
    candidate.relevanceScore * 5 +
    candidate.confidenceScore * 3 +
    candidate.criticalityScore * 2
  );
}

function adjustedLlmCandidateScore(
  candidate: LlmAcceptedCandidate,
  usageBySection: Map<string, number>
): number {
  const usageCount = usageBySection.get(candidate.section.id) ?? 0;
  let penalty = 0;

  if (usageCount > 0) {
    penalty += usageCount * SECTION_REUSE_PENALTY;
  }

  if (usageCount >= MAX_SECTION_REUSE_BEFORE_HARD_PENALTY) {
    penalty += 30;
  }

  if (candidate.evidenceNature === "illustrative") {
    penalty += 12;
  }

  if (candidate.evidenceNature === "unclear") {
    penalty += 6;
  }

  return llmCandidateBaseScore(candidate) - penalty;
}

function selectLlmCandidateForTheme(
  candidates: LlmAcceptedCandidate[],
  usageBySection: Map<string, number>
): LlmAcceptedCandidate | null {
  let selected: LlmAcceptedCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const score = adjustedLlmCandidateScore(candidate, usageBySection);
    if (score > bestScore) {
      bestScore = score;
      selected = candidate;
    }
  }

  return selected;
}

function buildExplicitSignalsFromLlm(params: {
  snapshot: BaseTrameSnapshot;
  responses: LlmSignalExtractionResponse[];
}): DiagnosticSignal[] {
  const allCandidates: LlmAcceptedCandidate[] = [];

  for (const response of params.responses) {
    for (const item of response.explicitSignals) {
      const candidate = toAcceptedLlmCandidate(
        params.snapshot,
        response.dimensionId,
        item
      );
      if (candidate) {
        allCandidates.push(candidate);
      }
    }
  }

  const buckets = new Map<string, LlmAcceptedCandidate[]>();

  for (const candidate of allCandidates) {
    const key = `${candidate.dimensionId}|${normalizeText(candidate.theme)}`;
    const current = buckets.get(key) ?? [];
    current.push(candidate);
    buckets.set(key, current);
  }

  const orderedBuckets = [...buckets.entries()]
    .map(([key, candidates]) => ({
      key,
      candidates: [...candidates].sort(
        (a, b) => llmCandidateBaseScore(b) - llmCandidateBaseScore(a)
      ),
    }))
    .sort(
      (a, b) =>
        llmCandidateBaseScore(b.candidates[0]) - llmCandidateBaseScore(a.candidates[0])
    );

  const usageBySection = new Map<string, number>();
  const explicitSignals: DiagnosticSignal[] = [];
  let runningIndex = 1;

  for (const bucket of orderedBuckets) {
    const selected = selectLlmCandidateForTheme(bucket.candidates, usageBySection);
    if (!selected) continue;

    usageBySection.set(
      selected.section.id,
      (usageBySection.get(selected.section.id) ?? 0) + 1
    );

    explicitSignals.push({
      id: makeSignalId(
        selected.dimensionId,
        selected.theme,
        selected.section.id,
        runningIndex++
      ),
      dimensionId: selected.dimensionId,
      theme: selected.theme,
      signalKind: "explicit",
      sourceType: "trame",
      sourceSection: selected.section.id,
      sourceExcerpt: normalizeExtractionText(selected.sourceExcerpt),
      constat:
        normalizeExtractionText(selected.constat) ||
        `La trame fournit un appui exploitable sur le thème "${selected.theme}".`,
      managerialRisk:
        normalizeExtractionText(selected.managerialRisk) ||
        buildManagerialRisk(selected.theme, false, selected.entryAngle),
      probableConsequence:
        normalizeExtractionText(selected.probableConsequence) ||
        buildProbableConsequence(selected.theme),
      entryAngle: selected.entryAngle,
      confidenceScore: clamp(selected.confidenceScore, 55, 95),
      criticalityScore: clamp(selected.criticalityScore, 60, 95),
    });
  }

  return dedupeSignals(explicitSignals);
}

function buildLlmUncoveredMap(
  responses: LlmSignalExtractionResponse[]
): Map<
  string,
  {
    reason: LlmUncoveredTheme["reason"];
    whyMissing: string;
    confidenceScore: number;
  }
> {
  const out = new Map<
    string,
    {
      reason: LlmUncoveredTheme["reason"];
      whyMissing: string;
      confidenceScore: number;
    }
  >();

  for (const response of responses) {
    for (const item of response.uncoveredThemes) {
      out.set(`${response.dimensionId}|${normalizeText(item.theme)}`, {
        reason: item.reason,
        whyMissing: item.whyMissing,
        confidenceScore: item.confidenceScore,
      });
    }
  }

  return out;
}

function buildRegistryFromSignals(signals: DiagnosticSignal[]): SignalRegistry {
  const allSignals = [...signals].sort((a, b) => {
    if (a.dimensionId !== b.dimensionId) return a.dimensionId - b.dimensionId;
    return b.criticalityScore - a.criticalityScore;
  });

  return buildEmptyRegistry(allSignals);
}

export function buildSignalRegistry(snapshot: BaseTrameSnapshot): SignalRegistry {
  const explicitSignals = buildExplicitSignalsDeterministic(snapshot);
  const absenceSignals = buildAbsenceSignals(snapshot, explicitSignals);

  return buildRegistryFromSignals([...explicitSignals, ...absenceSignals]);
}

export async function buildSignalRegistryWithLlm(
  snapshot: BaseTrameSnapshot
): Promise<SignalRegistry> {
  if (!llmSignalExtractionEnabled()) {
    return buildSignalRegistry(snapshot);
  }

  try {
    const responses = (
      await Promise.all(
        DIAGNOSTIC_DIMENSIONS.map((dimension) =>
          extractSignalsForDimensionWithLlm({
            snapshot,
            dimensionId: dimension.id,
          })
        )
      )
    ).filter(
      (item): item is LlmSignalExtractionResponse => item !== null
    );

    if (responses.length === 0) {
      return buildSignalRegistry(snapshot);
    }

    const explicitSignals = buildExplicitSignalsFromLlm({
      snapshot,
      responses,
    });

    const uncoveredMap = buildLlmUncoveredMap(responses);
    const absenceSignals = buildAbsenceSignals(snapshot, explicitSignals, uncoveredMap);

    return buildRegistryFromSignals([...explicitSignals, ...absenceSignals]);
  } catch {
    return buildSignalRegistry(snapshot);
  }
}