export type DimensionId = 1 | 2 | 3 | 4;

export type EvidenceLevel = "low" | "medium" | "high";

export type KnowledgePattern = {
  id: string;
  user_id?: string;
  source_type: "legacy_diagnostic";
  source_ref: string;
  dimension: DimensionId;
  themes: string[];
  facts: string[];
  finding: string;
  managerial_risk: string;
  recommendation?: string;
  evidence_level: EvidenceLevel;
  context_tags: string[];
  company_profile?: string;
  sector?: string;
  size_band?: string;
  geography?: string;
  confidence_score: number;
  created_at: string;
};

export type KnowledgeBase = {
  version: 1;
  patterns: KnowledgePattern[];
};

export type LegacyDiagnosticInput = {
  source_ref: string;
  company_name?: string;
  sector?: string;
  size_band?: string;
  geography?: string;
  content: string;
};

export type RetrievedPattern = {
  pattern: KnowledgePattern;
  score: number;
  why: string[];
};

const DIMENSION_THEMES: Record<DimensionId, string[]> = {
  1: [
    "gouvernance",
    "roles et responsabilites",
    "ligne manageriale",
    "relais d'encadrement",
    "competences critiques",
    "dependances humaines",
    "recrutement",
    "remplacement de profils inadaptés",
    "climat social",
    "adhesion des equipes",
    "management de proximite",
    "rituels manageriaux",
    "capacite d'execution managériale",
    "organisation interne",
    "structure de pilotage",
  ],
  2: [
    "segmentation clients",
    "prospection",
    "ciblage commercial",
    "portefeuille clients",
    "diversification",
    "positionnement marche",
    "proposition de valeur",
    "qualification opportunites",
    "pipeline",
    "funnel",
    "conversion",
    "animation commerciale",
    "priorisation opportunites",
    "motifs de gain ou de perte",
    "strategie de conquete",
  ],
  3: [
    "prix",
    "tarification",
    "positionnement prix",
    "negociation",
    "marge",
    "rentabilite affaire",
    "selectivite economique",
    "arbitrage go/no go",
    "cycle de vente",
    "duree cycle commercial",
    "conditions de negociation",
    "criteres de poursuite d'affaire",
    "discipline commerciale economique",
    "capitalisation affaires gagnees/perdues",
  ],
  4: [
    "execution",
    "pilotage operationnel",
    "qualite",
    "delais",
    "productivite",
    "rentabilite execution",
    "derives",
    "traitement des ecarts",
    "coordination commerce-etudes-production-terrain",
    "arbitrage des priorites",
    "charge et capacite",
    "rituels de pilotage operationnel",
    "causes de non-performance",
    "amelioration continue",
  ],
};

export function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const clean = String(value || "").trim();
    const key = normalizeText(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  return out;
}

export function inferThemes(
  dimension: DimensionId,
  text: string,
  maxThemes = 4
): string[] {
  const haystack = normalizeText(text);
  const themes = DIMENSION_THEMES[dimension];

  const matched = themes.filter((theme) => {
    const t = normalizeText(theme);
    return haystack.includes(t);
  });

  return uniqueStrings(matched).slice(0, maxThemes);
}

export function buildPatternId(input: {
  source_ref: string;
  dimension: DimensionId;
  finding: string;
  managerial_risk: string;
}) {
  return slugify(
    `${input.source_ref}-${input.dimension}-${input.finding}-${input.managerial_risk}`
  );
}

export function dedupePatterns(patterns: KnowledgePattern[]): KnowledgePattern[] {
  const byKey = new Map<string, KnowledgePattern>();

  for (const pattern of patterns) {
    const key = slugify(
      `${pattern.dimension}-${pattern.finding}-${pattern.managerial_risk}`
    );

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, pattern);
      continue;
    }

    if (pattern.confidence_score > existing.confidence_score) {
      byKey.set(key, pattern);
    }
  }

  return Array.from(byKey.values());
}

export function createKnowledgeBase(patterns: KnowledgePattern[]): KnowledgeBase {
  return {
    version: 1,
    patterns: dedupePatterns(patterns),
  };
}

function scorePatternAgainstContext(params: {
  pattern: KnowledgePattern;
  dimension: DimensionId;
  extractedText: string;
  learnedFacts: string[];
  validatedFindings: string[];
  targetThemes: string[];
  companyProfile?: string;
  sector?: string;
  sizeBand?: string;
}): RetrievedPattern {
  const {
    pattern,
    dimension,
    extractedText,
    learnedFacts,
    validatedFindings,
    targetThemes,
    companyProfile,
    sector,
    sizeBand,
  } = params;

  let score = 0;
  const why: string[] = [];

  if (pattern.dimension === dimension) {
    score += 35;
    why.push("même dimension");
  }

  const extracted = normalizeText(extractedText);
  const findingsText = normalizeText(validatedFindings.join(" | "));
  const factsText = normalizeText(learnedFacts.join(" | "));
  const targetThemeSet = new Set(targetThemes.map(normalizeText));

  const themeHits = pattern.themes.filter((theme) =>
    targetThemeSet.has(normalizeText(theme))
  ).length;

  if (themeHits > 0) {
    score += Math.min(20, themeHits * 7);
    why.push("thèmes proches");
  }

  const factHits = pattern.facts.filter((fact) => {
    const f = normalizeText(fact);
    return extracted.includes(f) || findingsText.includes(f) || factsText.includes(f);
  }).length;

  if (factHits > 0) {
    score += Math.min(18, factHits * 6);
    why.push("faits proches");
  }

  const findingNorm = normalizeText(pattern.finding);
  if (
    findingNorm &&
    (extracted.includes(findingNorm) ||
      findingsText.includes(findingNorm) ||
      factsText.includes(findingNorm))
  ) {
    score += 15;
    why.push("constat proche");
  }

  if (sector && pattern.sector && normalizeText(sector) === normalizeText(pattern.sector)) {
    score += 6;
    why.push("même secteur");
  }

  if (
    sizeBand &&
    pattern.size_band &&
    normalizeText(sizeBand) === normalizeText(pattern.size_band)
  ) {
    score += 4;
    why.push("même taille");
  }

  if (
    companyProfile &&
    pattern.company_profile &&
    normalizeText(companyProfile) === normalizeText(pattern.company_profile)
  ) {
    score += 4;
    why.push("profil comparable");
  }

  if (pattern.evidence_level === "high") {
    score += 8;
    why.push("preuve forte");
  } else if (pattern.evidence_level === "medium") {
    score += 4;
  }

  score += Math.round(pattern.confidence_score / 10);

  return {
    pattern,
    score,
    why,
  };
}

export function retrieveRelevantPatterns(params: {
  knowledgeBase: KnowledgeBase | null | undefined;
  dimension: DimensionId;
  extractedText: string;
  learnedFacts: string[];
  validatedFindings: string[];
  targetThemes: string[];
  companyProfile?: string;
  sector?: string;
  sizeBand?: string;
  limit?: number;
}): RetrievedPattern[] {
  const {
    knowledgeBase,
    dimension,
    extractedText,
    learnedFacts,
    validatedFindings,
    targetThemes,
    companyProfile,
    sector,
    sizeBand,
    limit = 5,
  } = params;

  if (!knowledgeBase?.patterns?.length) return [];

  return knowledgeBase.patterns
    .map((pattern) =>
      scorePatternAgainstContext({
        pattern,
        dimension,
        extractedText,
        learnedFacts,
        validatedFindings,
        targetThemes,
        companyProfile,
        sector,
        sizeBand,
      })
    )
    .filter((x) => x.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function serializeRetrievedPatterns(patterns: RetrievedPattern[]) {
  if (patterns.length === 0) {
    return "Aucun pattern pertinent.";
  }

  return patterns
    .map(
      (item, index) =>
        `Pattern ${index + 1}
- dimension: ${item.pattern.dimension}
- themes: ${item.pattern.themes.join(", ") || "n/a"}
- finding: ${item.pattern.finding}
- managerial_risk: ${item.pattern.managerial_risk}
- recommendation: ${item.pattern.recommendation || "n/a"}
- evidence_level: ${item.pattern.evidence_level}
- why: ${item.why.join(", ") || "proximité générale"}`
    )
    .join("\n");
}