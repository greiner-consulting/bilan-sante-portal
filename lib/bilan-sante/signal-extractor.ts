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

type LlmFilterDecision =
  | "accepted_non_anecdotal"
  | "rejected_no_section"
  | "rejected_anecdotal";

type LlmFilterStats = {
  total: number;
  acceptedNonAnecdotal: number;
  rejectedNoSection: number;
  rejectedAnecdotal: number;
};

const MAX_EXCERPT_LENGTH = 280;
const MIN_EXPLICIT_SCORE = 28;
const STRONG_EXPLICIT_SCORE = 38;
const SECTION_REUSE_PENALTY = 12;
const GENERIC_REUSE_EXTRA_PENALTY = 6;
const MAX_EXPLICIT_SIGNALS_PER_THEME = 3;
const SECONDARY_DETERMINISTIC_GAP = 22;
const SECONDARY_LLM_RATIO = 0.64;

const LOG_PREFIX = "[BilanSante][SignalExtraction]";

function logInfo(event: string, payload?: Record<string, unknown>) {
  console.info(`${LOG_PREFIX} ${event}`, payload ?? {});
}

function logWarn(event: string, payload?: Record<string, unknown>) {
  console.warn(`${LOG_PREFIX} ${event}`, payload ?? {});
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "unknown_error");
}

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
      "chef de chantier",
      "chefs de chantier",
      "niveau à date",
    ],
    "ressources vs charge": [
      "charge",
      "capacité",
      "ressources",
      "sous-effectif",
      "surcharge",
      "planning",
      "disponibilité",
      "charge capacité",
      "planifier",
      "planification",
      "staffing",
      "5 semaines",
    ],
    "turnover absentéisme stabilité": [
      "turnover",
      "absentéisme",
      "stabilité",
      "départ",
      "fidélisation",
      "rotation",
      "absenteisme",
    ],
    "recrutement et intégration": [
      "recrutement",
      "recruter",
      "intégration",
      "onboarding",
      "embauche",
      "embauches",
      "besoins",
      "intégrer",
    ],
    "clarté des rôles": [
      "rôle",
      "responsabilité",
      "organigramme",
      "périmètre",
      "délégation",
      "poste",
      "autorité",
      "périmètre de responsabilité",
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
    "cause",
    "origine",
    "explique",
    "lié à",
    "liée à",
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
    "budget",
    "surdimension",
    "volume nécessaire",
    "volume necessaire",
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

function normalizeLlmScore(value: number): number {
  const safe = clamp(Number(value ?? 0), 0, 100);

  if (safe <= 5) {
    return clamp(safe * 20, 0, 100);
  }

  if (safe <= 10) {
    return clamp(safe * 10, 0, 100);
  }

  return safe;
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

  if (items.length === 0) return "des éléments de la trame à préciser";
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
    .slice(0, 70);

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

function textIncludesAny(text: string, patterns: string[]): boolean {
  const normalized = normalizeText(text);
  return patterns.some((pattern) => normalized.includes(normalizeText(pattern)));
}

function looksLikeGrowthStaffingCase(text: string): boolean {
  const growthTerms = [
    "croissance",
    "volume",
    "charge",
    "montée en charge",
    "montee en charge",
    "activité",
    "activite",
    "développement",
    "developpement",
  ];

  const staffingTerms = [
    "recrut",
    "encadrement",
    "équipe",
    "equipe",
    "ressource",
    "effectif",
    "staffing",
    "profil",
  ];

  return textIncludesAny(text, growthTerms) && textIncludesAny(text, staffingTerms);
}

function looksLikeAdvanceStructureCase(text: string): boolean {
  return textIncludesAny(text, [
    "surdimension",
    "surdimensionné",
    "surdimensionne",
    "pas encore le volume",
    "pas encore le niveau",
    "pas encore la charge",
    "pour soutenir la croissance",
    "en avance de phase",
    "avant le volume nécessaire",
    "avant le volume necessaire",
  ]);
}

function looksLikeEconomicJustificationCase(text: string): boolean {
  return textIncludesAny(text, [
    "coût",
    "cout",
    "marge",
    "rentabilité",
    "rentabilite",
    "coût fixe",
    "cout fixe",
    "structure de coûts",
    "structure de couts",
    "justifié",
    "justifie",
    "surdimension",
    "volume nécessaire",
    "volume necessaire",
  ]);
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

  // Simple hint faible, pas angle métier fort
  if (looksLikeGrowthStaffingCase(text)) {
    if (looksLikeAdvanceStructureCase(text) || looksLikeEconomicJustificationCase(text)) {
      return "economics";
    }
    return "causality";
  }

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

function buildMinimalRisk(
  theme: string,
  isAbsence: boolean
): string {
  if (isAbsence) {
    return `Le thème "${theme}" apparaît insuffisamment documenté ou objectivé dans la trame.`;
  }

  return `La matière disponible sur le thème "${theme}" invite à clarifier ce sujet avant d'en tirer une conclusion plus structurée.`;
}

function buildProbableConsequence(theme: string): string {
  const lower = theme.toLowerCase();

  if (lower.includes("prix") || lower.includes("chiffrage")) {
    return "Point à vérifier sur les effets possibles sur la marge ou la rentabilité.";
  }

  if (lower.includes("commercial") || lower.includes("croissance")) {
    return "Point à vérifier sur la capacité à soutenir une croissance réellement maîtrisée.";
  }

  if (
    lower.includes("cash") ||
    lower.includes("marge") ||
    lower.includes("résultat")
  ) {
    return "Point à vérifier sur les effets possibles sur la visibilité économique.";
  }

  if (
    lower.includes("rôle") ||
    lower.includes("équipe") ||
    lower.includes("recrutement")
  ) {
    return "Point à vérifier sur la solidité de l'organisation ou du dimensionnement.";
  }

  return "Point à vérifier sur la robustesse du fonctionnement réel ou du pilotage.";
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

function sameDeterministicIdea(left: ThemeCandidate, right: ThemeCandidate): boolean {
  return (
    left.section.id === right.section.id &&
    left.entryAngle === right.entryAngle &&
    normalizeText(left.excerpt) === normalizeText(right.excerpt)
  );
}

function canAddDeterministicCandidate(
  selected: ThemeCandidate[],
  candidate: ThemeCandidate
): boolean {
  return !selected.some((existing) => sameDeterministicIdea(existing, candidate));
}

function selectCandidatesForTheme(
  candidates: ThemeCandidate[],
  usageBySection: Map<string, number>
): ThemeCandidate[] {
  if (candidates.length === 0) return [];

  const adjusted = candidates
    .map((candidate) => ({
      candidate,
      adjustedScore: adjustedCandidateScore(candidate, usageBySection),
    }))
    .sort((a, b) => b.adjustedScore - a.adjustedScore);

  const primary = adjusted[0];
  if (!primary) return [];

  const selected: ThemeCandidate[] = [];
  if (primary.adjustedScore >= MIN_EXPLICIT_SCORE || primary.candidate.score >= STRONG_EXPLICIT_SCORE) {
    selected.push(primary.candidate);
  }

  if (selected.length === 0) return [];

  for (const { candidate, adjustedScore } of adjusted.slice(1)) {
    if (selected.length >= MAX_EXPLICIT_SIGNALS_PER_THEME) break;
    if (!canAddDeterministicCandidate(selected, candidate)) continue;

    const distinctFromPrimary =
      selected[0].section.id !== candidate.section.id ||
      selected[0].entryAngle !== candidate.entryAngle;

    if (!distinctFromPrimary && adjustedScore < STRONG_EXPLICIT_SCORE + 4) {
      continue;
    }

    const strongEnough =
      adjustedScore >= Math.max(MIN_EXPLICIT_SCORE - 2, primary.adjustedScore - SECONDARY_DETERMINISTIC_GAP) ||
      candidate.score >= STRONG_EXPLICIT_SCORE + 4;

    if (!strongEnough) continue;
    selected.push(candidate);
  }

  return selected;
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
      const selectedCandidates = selectCandidatesForTheme(bucket.candidates, usageBySection);
      if (selectedCandidates.length === 0) continue;

      for (const selected of selectedCandidates) {
        usageBySection.set(
          selected.section.id,
          (usageBySection.get(selected.section.id) ?? 0) + 1
        );

        signals.push({
          id: makeSignalId(dimension.id, bucket.theme, `${selected.section.id}-${selected.entryAngle}`, runningIndex++),
          dimensionId: dimension.id,
          theme: bucket.theme,
          signalKind: "explicit",
          sourceType: "trame",
          sourceSection: selected.section.id,
          sourceExcerpt: selected.excerpt || "",
          constat: selected.constat,
          managerialRisk: buildMinimalRisk(bucket.theme, false),
          probableConsequence: buildProbableConsequence(bucket.theme),
          entryAngle: selected.entryAngle,
          confidenceScore: scoreConfidenceFromCandidate(selected),
          criticalityScore: scoreCriticality(bucket.theme, false, selected.entryAngle),
        });
      }
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

function buildAbsenceConstat(
  theme: string,
  llmMissing?: { reason: LlmUncoveredTheme["reason"]; whyMissing: string },
  missingFieldHit?: MissingField
): string {
  if (llmMissing?.reason === "only_illustrative" || llmMissing?.reason === "too_weak") {
    return `Le thème "${theme}" reste insuffisamment consolidé dans la trame : la matière disponible existe mais demeure trop partielle pour établir un support exploitable.`;
  }

  if (llmMissing?.reason === "not_enough_material") {
    return `Le thème "${theme}" apparaît encore trop peu documenté dans la trame pour établir un appui réellement exploitable.`;
  }

  if (llmMissing) {
    return `Le thème "${theme}" ressort comme insuffisamment étayé dans la trame (${llmMissing.reason}).`;
  }

  if (missingFieldHit) {
    return `Le thème "${theme}" ressort comme absent, incomplet ou insuffisamment documenté dans la trame, notamment via le champ "${missingFieldHit.label}".`;
  }

  return `Le thème "${theme}" est absent, peu documenté ou insuffisamment suivi dans la trame.`;
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

      const constat = buildAbsenceConstat(theme, llmMissing, missingFieldHit);

      results.push({
        id: makeSignalId(dimension.id, theme, "absence", runningIndex++),
        dimensionId: dimension.id,
        theme,
        signalKind: "absence",
        sourceType: "trame",
        sourceSection: null,
        sourceExcerpt: sourceExcerpt || "",
        constat,
        managerialRisk: buildMinimalRisk(theme, true),
        probableConsequence: buildProbableConsequence(theme),
        entryAngle: "formalization",
        confidenceScore: clamp(
          llmMissing?.confidenceScore ?? (missingFieldHit ? 82 : 78),
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
      signal.entryAngle,
      normalizeText(String(signal.sourceExcerpt ?? "")),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(signal);
  }

  return out;
}

function findSectionById(
  snapshot: BaseTrameSnapshot,
  sectionId: string
): TrameSection | undefined {
  return snapshot.sections.find((section) => String(section.id ?? "").trim() === sectionId);
}

function initLlmFilterStats(): LlmFilterStats {
  return {
    total: 0,
    acceptedNonAnecdotal: 0,
    rejectedNoSection: 0,
    rejectedAnecdotal: 0,
  };
}

function registerLlmDecision(
  stats: LlmFilterStats,
  decision: LlmFilterDecision
): void {
  stats.total += 1;

  switch (decision) {
    case "accepted_non_anecdotal":
      stats.acceptedNonAnecdotal += 1;
      break;
    case "rejected_no_section":
      stats.rejectedNoSection += 1;
      break;
    case "rejected_anecdotal":
      stats.rejectedAnecdotal += 1;
      break;
  }
}

function evaluateLlmSignalAcceptance(
  item: LlmExtractedExplicitSignal
): LlmFilterDecision {
  if (item.evidenceNature === "anecdotal") {
    return "rejected_anecdotal";
  }

  return "accepted_non_anecdotal";
}

function logLlmCandidateSample(params: {
  dimensionId: DimensionId;
  item: LlmExtractedExplicitSignal;
  decision: LlmFilterDecision;
}): void {
  console.info("[BilanSante][SignalExtraction] llm_candidate_sample", {
    dimensionId: params.dimensionId,
    theme: params.item.theme,
    evidenceNature: params.item.evidenceNature,
    relevanceScoreRaw: params.item.relevanceScore,
    confidenceScoreRaw: params.item.confidenceScore,
    criticalityScoreRaw: params.item.criticalityScore,
    relevanceScoreNormalized: normalizeLlmScore(params.item.relevanceScore),
    confidenceScoreNormalized: normalizeLlmScore(params.item.confidenceScore),
    criticalityScoreNormalized: normalizeLlmScore(params.item.criticalityScore),
    decision: params.decision,
  });
}

function toAcceptedLlmCandidate(
  snapshot: BaseTrameSnapshot,
  dimensionId: DimensionId,
  item: LlmExtractedExplicitSignal,
  stats?: LlmFilterStats
): LlmAcceptedCandidate | null {
  const section = findSectionById(snapshot, item.sourceSectionId);
  if (!section) {
    if (stats) registerLlmDecision(stats, "rejected_no_section");
    return null;
  }

  const decision = evaluateLlmSignalAcceptance(item);

  if (stats) registerLlmDecision(stats, decision);

  logLlmCandidateSample({
    dimensionId,
    item,
    decision,
  });

  if (decision !== "accepted_non_anecdotal") {
    return null;
  }

  return {
    dimensionId,
    theme: item.theme,
    section,
    sourceExcerpt: item.sourceExcerpt,
    evidenceNature: item.evidenceNature,
    entryAngle: item.entryAngle,
    relevanceScore: normalizeLlmScore(item.relevanceScore),
    confidenceScore: normalizeLlmScore(item.confidenceScore),
    criticalityScore: normalizeLlmScore(item.criticalityScore),
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

function sameLlmIdea(left: LlmAcceptedCandidate, right: LlmAcceptedCandidate): boolean {
  return (
    left.section.id === right.section.id &&
    left.entryAngle === right.entryAngle &&
    normalizeText(left.sourceExcerpt) === normalizeText(right.sourceExcerpt)
  );
}

function canAddLlmCandidate(
  selected: LlmAcceptedCandidate[],
  candidate: LlmAcceptedCandidate
): boolean {
  return !selected.some((existing) => sameLlmIdea(existing, candidate));
}

function selectLlmCandidatesForTheme(
  candidates: LlmAcceptedCandidate[],
  usageBySection: Map<string, number>
): LlmAcceptedCandidate[] {
  if (candidates.length === 0) return [];

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: adjustedLlmCandidateScore(candidate, usageBySection),
      base: llmCandidateBaseScore(candidate),
    }))
    .sort((a, b) => b.score - a.score);

  const primary = ranked[0];
  if (!primary) return [];

  const selected: LlmAcceptedCandidate[] = [primary.candidate];

  for (const item of ranked.slice(1)) {
    if (selected.length >= MAX_EXPLICIT_SIGNALS_PER_THEME) break;
    if (!canAddLlmCandidate(selected, item.candidate)) continue;

    const strongEnough =
      item.score >= primary.score * SECONDARY_LLM_RATIO ||
      item.base >= primary.base * SECONDARY_LLM_RATIO;

    if (!strongEnough) continue;
    selected.push(item.candidate);
  }

  return selected;
}

function buildExplicitSignalsFromLlm(params: {
  snapshot: BaseTrameSnapshot;
  responses: LlmSignalExtractionResponse[];
  logContext?: string;
}): DiagnosticSignal[] {
  const allCandidates: LlmAcceptedCandidate[] = [];
  const filterStats = initLlmFilterStats();

  for (const response of params.responses) {
    for (const item of response.explicitSignals) {
      const candidate = toAcceptedLlmCandidate(
        params.snapshot,
        response.dimensionId,
        item,
        filterStats
      );
      if (candidate) {
        allCandidates.push(candidate);
      }
    }
  }

  logInfo("llm_candidate_filter_summary", {
    context: params.logContext ?? "default",
    totalCandidates: filterStats.total,
    acceptedNonAnecdotal: filterStats.acceptedNonAnecdotal,
    rejectedNoSection: filterStats.rejectedNoSection,
    rejectedAnecdotal: filterStats.rejectedAnecdotal,
    acceptedCandidates: filterStats.acceptedNonAnecdotal,
  });

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
    const selectedCandidates = selectLlmCandidatesForTheme(bucket.candidates, usageBySection);
    if (selectedCandidates.length === 0) continue;

    for (const selected of selectedCandidates) {
      usageBySection.set(
        selected.section.id,
        (usageBySection.get(selected.section.id) ?? 0) + 1
      );

      explicitSignals.push({
        id: makeSignalId(
          selected.dimensionId,
          selected.theme,
          `${selected.section.id}-${selected.entryAngle}`,
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
        managerialRisk: buildMinimalRisk(selected.theme, false),
        probableConsequence:
          normalizeExtractionText(selected.probableConsequence) ||
          buildProbableConsequence(selected.theme),
        entryAngle: selected.entryAngle,
        confidenceScore: clamp(Math.max(selected.confidenceScore, 50), 50, 95),
        criticalityScore: clamp(Math.max(selected.criticalityScore, 60), 60, 95),
      });
    }
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

function signalThemeKey(signal: DiagnosticSignal): string {
  return `${signal.dimensionId}|${normalizeText(signal.theme)}`;
}

function signalSignatureKey(signal: DiagnosticSignal): string {
  return [
    signal.dimensionId,
    normalizeText(signal.theme),
    String(signal.sourceSection ?? "none"),
    signal.entryAngle,
    normalizeText(signal.sourceExcerpt),
  ].join("|");
}

function mergeExplicitSignalsWithDeterministicRescue(params: {
  llmSignals: DiagnosticSignal[];
  deterministicSignals: DiagnosticSignal[];
}): {
  explicitSignals: DiagnosticSignal[];
  rescuedSignals: DiagnosticSignal[];
} {
  const llmSignatures = new Set(params.llmSignals.map(signalSignatureKey));
  const themeCounts = new Map<string, number>();
  for (const signal of params.llmSignals) {
    const key = signalThemeKey(signal);
    themeCounts.set(key, (themeCounts.get(key) ?? 0) + 1);
  }

  const rescuedSignals = params.deterministicSignals.filter((signal) => {
    if (signal.signalKind !== "explicit") return false;
    if (signal.confidenceScore < 58) return false;
    const signature = signalSignatureKey(signal);
    if (llmSignatures.has(signature)) return false;
    const themeKey = signalThemeKey(signal);
    const currentCount = themeCounts.get(themeKey) ?? 0;
    if (currentCount >= MAX_EXPLICIT_SIGNALS_PER_THEME) return false;
    themeCounts.set(themeKey, currentCount + 1);
    return true;
  });

  return {
    explicitSignals: dedupeSignals([...params.llmSignals, ...rescuedSignals]),
    rescuedSignals,
  };
}

function buildRegistryFromSignals(signals: DiagnosticSignal[]): SignalRegistry {
  const allSignals = [...signals].sort((a, b) => {
    if (a.dimensionId !== b.dimensionId) return a.dimensionId - b.dimensionId;
    if (a.signalKind !== b.signalKind) {
      return a.signalKind === "explicit" ? -1 : 1;
    }
    return b.criticalityScore - a.criticalityScore;
  });

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

function summarizeRegistry(registry: SignalRegistry) {
  const allSignals: DiagnosticSignal[] = registry.allSignals;
  const explicitSignals = allSignals.filter(
    (signal: DiagnosticSignal) => signal.signalKind === "explicit"
  );
  const absenceSignals = allSignals.filter(
    (signal: DiagnosticSignal) => signal.signalKind === "absence"
  );

  return {
    totalSignals: allSignals.length,
    explicitSignals: explicitSignals.length,
    absenceSignals: absenceSignals.length,
    d1: registry.byDimension.d1.length,
    d2: registry.byDimension.d2.length,
    d3: registry.byDimension.d3.length,
    d4: registry.byDimension.d4.length,
  };
}

function buildDeterministicRegistry(snapshot: BaseTrameSnapshot): SignalRegistry {
  const explicitSignals = buildExplicitSignalsDeterministic(snapshot);
  const absenceSignals = buildAbsenceSignals(snapshot, explicitSignals);

  return buildRegistryFromSignals([...explicitSignals, ...absenceSignals]);
}

export function buildSignalRegistry(snapshot: BaseTrameSnapshot): SignalRegistry {
  return buildDeterministicRegistry(snapshot);
}

export async function buildSignalRegistryWithLlm(
  snapshot: BaseTrameSnapshot
): Promise<SignalRegistry> {
  const hasOpenAiKey = llmSignalExtractionEnabled();

  logInfo("bootstrap_start", {
    hasOpenAiKey,
    sections: snapshot.sections.length,
    missingFields: snapshot.missingFields.length,
  });

  if (!hasOpenAiKey) {
    const deterministicRegistry = buildDeterministicRegistry(snapshot);

    logWarn("fallback_no_api_key", {
      hasOpenAiKey: false,
      fallbackUsed: true,
      ...summarizeRegistry(deterministicRegistry),
    });

    return deterministicRegistry;
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

    const rawExplicitSignals = responses.reduce(
      (sum, response) => sum + response.explicitSignals.length,
      0
    );
    const rawUncoveredThemes = responses.reduce(
      (sum, response) => sum + response.uncoveredThemes.length,
      0
    );

    if (responses.length === 0) {
      const deterministicRegistry = buildDeterministicRegistry(snapshot);

      logWarn("fallback_no_llm_response", {
        hasOpenAiKey: true,
        responsesReceived: 0,
        rawExplicitSignals,
        rawUncoveredThemes,
        fallbackUsed: true,
        ...summarizeRegistry(deterministicRegistry),
      });

      return deterministicRegistry;
    }

    const llmExplicitSignals = buildExplicitSignalsFromLlm({
      snapshot,
      responses,
      logContext: "primary",
    });
    const deterministicExplicitSignals = buildExplicitSignalsDeterministic(snapshot);
    const merged = mergeExplicitSignalsWithDeterministicRescue({
      llmSignals: llmExplicitSignals,
      deterministicSignals: deterministicExplicitSignals,
    });

    const uncoveredMap = buildLlmUncoveredMap(responses);
    const absenceSignals = buildAbsenceSignals(snapshot, merged.explicitSignals, uncoveredMap);
    const llmRegistry = buildRegistryFromSignals([...merged.explicitSignals, ...absenceSignals]);

    logInfo("llm_registry_ready", {
      hasOpenAiKey: true,
      responsesReceived: responses.length,
      rawExplicitSignals,
      explicitSignalsFromLlm: llmExplicitSignals.length,
      explicitSignalsRescuedDeterministically: merged.rescuedSignals.length,
      explicitSignalsFinal: merged.explicitSignals.length,
      uncoveredThemes: uncoveredMap.size,
      fallbackUsed: false,
      ...summarizeRegistry(llmRegistry),
    });

    return llmRegistry;
  } catch (error) {
    const deterministicRegistry = buildDeterministicRegistry(snapshot);

    logWarn("fallback_exception", {
      hasOpenAiKey: true,
      error: summarizeError(error),
      fallbackUsed: true,
      ...summarizeRegistry(deterministicRegistry),
    });

    return deterministicRegistry;
  }
}
