import type {
  BaseTrame,
  BaseTrameSnapshot,
  MissingFieldSignal,
  QualityFlag,
  TrameSection,
} from "@/lib/bilan-sante/session-model";
import {
  DIAGNOSTIC_DIMENSIONS,
  type DimensionId,
} from "@/lib/bilan-sante/protocol";

type DimensionStructureRule = {
  dimensionId: DimensionId;
  label: string;
  headingAliases: string[];
};

type ThemeEvidence = {
  theme: string;
  score: number;
  sourceSectionIds: string[];
  sourceHeadings: string[];
};

type TrameDimensionBlueprint = {
  dimensionId: DimensionId;
  label: string;
  detectedSectionIds: string[];
  detectedHeadings: string[];
  isPresent: boolean;
  expressedThemes: string[];
  inferredThemes: string[];
  selectedThemes: string[];
  weakSignalThemes: string[];
};

type TrameStructureValidation = {
  isValid: boolean;
  missingDimensionIds: DimensionId[];
  missingDimensionLabels: string[];
  message: string;
};

const STRUCTURE_RULES: DimensionStructureRule[] = [
  {
    dimensionId: 1,
    label: "Organisation & RH",
    headingAliases: [
      "organisation",
      "organisation et rh",
      "organisation & rh",
      "ressources humaines",
      "organisation & ressources humaines",
      "organisation et ressources humaines",
      "equipes",
      "équipes",
      "rh",
    ],
  },
  {
    dimensionId: 2,
    label: "Commercial & Marchés",
    headingAliases: [
      "commercial",
      "commercial et marches",
      "commercial & marches",
      "marches",
      "marchés",
      "strategie commerciale",
      "stratégie commerciale",
      "developpement commercial",
      "développement commercial",
    ],
  },
  {
    dimensionId: 3,
    label: "Cycle de vente & Prix",
    headingAliases: [
      "cycle de vente",
      "offres et prix",
      "offres & prix",
      "prix",
      "chiffrage",
      "devis",
      "vente et prix",
      "cycle de vente offres prix",
    ],
  },
  {
    dimensionId: 4,
    label: "Exécution & Performance opérationnelle",
    headingAliases: [
      "execution",
      "exécution",
      "performance operationnelle",
      "performance opérationnelle",
      "realisation",
      "réalisation",
      "production",
      "performance",
      "securite qualite",
      "sécurité qualité",
    ],
  },
];

const THEME_KEYWORDS_BY_DIMENSION: Record<DimensionId, Record<string, string[]>> = {
  1: {
    "qualité et adéquation des équipes": [
      "équipe","equipes","compétence","competence","profil","encadrement","expérience","experience","formation","niveau","senior","chef de chantier","chefs de chantier",
    ],
    "ressources vs charge": [
      "ressources","charge","capacité","capacite","sous-effectif","sous effectif","planning","disponibilité","disponibilite","staffing",
    ],
    "turnover absentéisme stabilité": [
      "turnover","absentéisme","absenteisme","stabilité","stabilite","départ","départs","rotation","fidélisation","fidelisation",
    ],
    "recrutement et intégration": [
      "recrutement","recruter","embauche","embauches","intégration","integration","onboarding",
    ],
    "clarté des rôles": [
      "rôle","rôles","role","roles","responsabilité","responsabilite","organigramme","périmètre","perimetre","délégation","delegation",
    ],
  },
  2: {
    "stratégie commerciale": [
      "stratégie commerciale","strategie commerciale","ciblage","segmentation","positionnement","prospection","offre","marché","marche",
    ],
    "portage managérial et déploiement réel": [
      "animation commerciale","déploiement","deploiement","portage","management commercial","pilotage commercial","plan d'action","plan action",
    ],
    "indicateurs funnel / taux de succès": [
      "pipeline","funnel","conversion","taux de succès","taux de succes","taux de transformation","opportunité","opportunite","devis gagné","devis gagne",
    ],
    "capacité à générer une croissance rentable": [
      "croissance","rentable","rentabilité commerciale","rentabilite commerciale","développement rentable","developpement rentable","marge commerciale",
    ],
  },
  3: {
    "construction du prix et hypothèses": [
      "prix","tarif","tarification","hypothèse","hypothese","devis","chiffrage","remise",
    ],
    "délégation et arbitrage": [
      "arbitrage","validation","délégation","delegation","décision","decision","autorisation","escalade",
    ],
    "fiabilité du chiffrage": [
      "fiabilité","fiabilite","écart","ecart","coût réel","cout reel","dérive","derive","sous-chiffrage","sous chiffrage","surcoût","surcout",
    ],
    "taux de succès et critères": [
      "taux de succès","taux de succes","critère","critere","go / no go","go/no go","sélection","selection","qualification",
    ],
    "maîtrise des écarts prix vendu / coût réel": [
      "prix vendu","coût réel","cout reel","marge","écart","ecart","rentabilité","rentabilite","dérive","derive",
    ],
  },
  4: {
    "sécurité qualité performance économique": [
      "sécurité","securite","qualité","qualite","performance","non-qualité","non qualite","incident","accident","conformité","conformite",
    ],
    "indicateurs et rituels managériaux": [
      "indicateur","indicateurs","rituel","rituels","pilotage","revue","tableau de bord","kpi",
    ],
    "productivité et gestion des effectifs": [
      "productivité","productivite","effectif","effectifs","charge","planning","capacité","capacite","rendement",
    ],
    "pilotage cash résultat marges": [
      "cash","trésorerie","tresorerie","résultat","resultat","marge","marges","rentabilité","rentabilite","ebitda",
    ],
  },
};

function compact(value: string): string {
  return String(value ?? "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

function normalizeText(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = compact(value);
    const key = normalizeText(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out;
}

function splitIntoSections(rawText: string): TrameSection[] {
  const normalized = String(rawText ?? "").replace(/\r/g, "");
  const parts = normalized
    .split(/\n{2,}|(?=SECTION\s+\d+)|(?=CHAPITRE\s+\d+)|(?=DOMAINE\s+\d+)|(?=DIMENSION\s+\d+)|(?=\d+\s*[). -]\s+)/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return parts.map((part, index) => {
    const firstLine = part.split("\n")[0] ?? `Section ${index + 1}`;
    const heading = compact(firstLine).slice(0, 160) || `Section ${index + 1}`;

    return {
      id: `section-${index + 1}`,
      title: heading,
      heading,
      content: compact(part),
      sectionNumber: String(index + 1),
      qualityFlags: [],
      missingFields: [],
    };
  });
}

function scoreAliasHits(text: string, aliases: string[]): number {
  const normalized = normalizeText(text);
  let score = 0;
  for (const alias of aliases) {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias) continue;
    if (normalized.includes(normalizedAlias)) {
      score += normalizedAlias.length >= 12 ? 8 : 5;
    }
  }
  return score;
}

function detectDimensionSections(
  sections: TrameSection[],
  rule: DimensionStructureRule
): TrameSection[] {
  return sections.filter((section) => {
    const headingScore = scoreAliasHits(section.heading, rule.headingAliases) * 2;
    const contentScore = scoreAliasHits(section.content, rule.headingAliases);
    return headingScore + contentScore >= 10;
  });
}

function scoreThemeEvidence(
  sections: TrameSection[],
  theme: string,
  keywords: string[]
): ThemeEvidence {
  const themeTokens = tokenize(theme);
  let score = 0;
  const sourceSectionIds: string[] = [];
  const sourceHeadings: string[] = [];

  for (const section of sections) {
    const headingNorm = normalizeText(section.heading);
    const contentNorm = normalizeText(section.content);
    const tokens = new Set<string>([
      ...tokenize(section.heading),
      ...tokenize(section.content),
    ]);

    let sectionScore = 0;
    if (headingNorm.includes(normalizeText(theme))) sectionScore += 12;
    if (contentNorm.includes(normalizeText(theme))) sectionScore += 8;

    for (const keyword of keywords) {
      const normalizedKeyword = normalizeText(keyword);
      if (!normalizedKeyword) continue;
      if (headingNorm.includes(normalizedKeyword)) sectionScore += 6;
      if (contentNorm.includes(normalizedKeyword)) sectionScore += 3;
    }

    for (const token of themeTokens) {
      if (tokens.has(token)) sectionScore += 2;
    }

    if (sectionScore > 0) {
      score += sectionScore;
      sourceSectionIds.push(section.id);
      sourceHeadings.push(section.heading);
    }
  }

  return {
    theme,
    score,
    sourceSectionIds: uniqueStrings(sourceSectionIds),
    sourceHeadings: uniqueStrings(sourceHeadings),
  };
}

function buildDimensionBlueprint(
  dimensionId: DimensionId,
  sections: TrameSection[]
): TrameDimensionBlueprint {
  const definition = DIAGNOSTIC_DIMENSIONS.find((item) => item.id === dimensionId);
  const rule = STRUCTURE_RULES.find((item) => item.dimensionId === dimensionId);

  if (!definition || !rule) {
    throw new Error(`TRAME_BLUEPRINT_MISSING: dimension ${dimensionId}`);
  }

  const detectedSections = detectDimensionSections(sections, rule);

  const evidences = Object.entries(THEME_KEYWORDS_BY_DIMENSION[dimensionId])
    .map(([theme, keywords]) => scoreThemeEvidence(detectedSections, theme, keywords))
    .sort((a, b) => b.score - a.score);

  const strongExpressed = evidences.filter((item) => item.score >= 12).map((item) => item.theme);
  const weakExpressed = evidences.filter((item) => item.score >= 5 && item.score < 12).map((item) => item.theme);

  const expressedThemes = uniqueStrings([...strongExpressed, ...weakExpressed]).slice(0, 3);
  const selectedThemes = [...expressedThemes];
  const inferredThemes: string[] = [];

  if (selectedThemes.length < 3) {
    const remainingThemes = definition.requiredThemes.filter(
      (theme) => !selectedThemes.some((item) => normalizeText(item) === normalizeText(theme))
    );

    if (remainingThemes.length > 0) {
      selectedThemes.push(remainingThemes[0]);
      inferredThemes.push(remainingThemes[0]);
    }
  }

  return {
    dimensionId,
    label: definition.shortTitle,
    detectedSectionIds: uniqueStrings(detectedSections.map((item) => item.id)),
    detectedHeadings: uniqueStrings(detectedSections.map((item) => item.heading)),
    isPresent: detectedSections.length > 0,
    expressedThemes,
    inferredThemes,
    selectedThemes: uniqueStrings(selectedThemes).slice(0, 3),
    weakSignalThemes: weakExpressed.filter(
      (theme) => !expressedThemes.some((item) => normalizeText(item) === normalizeText(theme))
    ),
  };
}

function buildStructureValidation(
  blueprints: TrameDimensionBlueprint[]
): TrameStructureValidation {
  const missing = blueprints.filter((item) => !item.isPresent);
  if (missing.length === 0) {
    return {
      isValid: true,
      missingDimensionIds: [],
      missingDimensionLabels: [],
      message: "Architecture de trame conforme aux 4 domaines attendus.",
    };
  }

  const labels = missing.map((item) => item.label);
  return {
    isValid: false,
    missingDimensionIds: missing.map((item) => item.dimensionId),
    missingDimensionLabels: labels,
    message: `La trame ne respecte pas l’architecture minimale attendue. Domaine(s) manquant(s) ou non reconnaissable(s) : ${labels.join(", ")}.`,
  };
}

function deriveQualityFlags(
  rawText: string,
  blueprints: TrameDimensionBlueprint[]
): QualityFlag[] {
  const flags: QualityFlag[] = [];
  const text = String(rawText ?? "").toLowerCase();

  if (text.length < 500) {
    flags.push({
      code: "TRAME_TOO_SHORT",
      severity: "warning",
      level: "warning",
      message: "La matière extraite paraît courte pour un diagnostic complet.",
    });
  }

  for (const blueprint of blueprints) {
    if (!blueprint.isPresent) continue;

    if (blueprint.selectedThemes.length < 3) {
      flags.push({
        code: `DIMENSION_${blueprint.dimensionId}_THEMES_UNDER_TARGET`,
        severity: "warning",
        level: "warning",
        message: `La dimension "${blueprint.label}" ne fournit pas 3 thèmes réellement exploitables. Le moteur restera contraint sur ${blueprint.selectedThemes.length} thème(s).`,
      });
    }

    if (blueprint.inferredThemes.length > 0) {
      flags.push({
        code: `DIMENSION_${blueprint.dimensionId}_INFERRED_THEME_USED`,
        severity: "info",
        level: "info",
        message: `La dimension "${blueprint.label}" nécessite ${blueprint.inferredThemes.length} thème inféré pour compléter le cadre d’exploration.`,
      });
    }
  }

  return flags;
}

function deriveMissingFields(
  blueprints: TrameDimensionBlueprint[]
): MissingFieldSignal[] {
  const missing: MissingFieldSignal[] = [];

  for (const blueprint of blueprints) {
    const definition = DIAGNOSTIC_DIMENSIONS.find((item) => item.id === blueprint.dimensionId);
    const notSelected = (definition?.requiredThemes ?? []).filter(
      (theme) =>
        !blueprint.selectedThemes.some(
          (selected) => normalizeText(selected) === normalizeText(theme)
        )
    );

    for (const theme of notSelected.slice(0, 2)) {
      missing.push({
        field: theme,
        label: theme,
        severity: "medium",
        message: `Le thème "${theme}" n’apparaît pas comme suffisamment exploitable dans la trame pour être retenu dans le plan d’exploration de la dimension.`,
        dimensionId: blueprint.dimensionId,
        sourceText: blueprint.detectedHeadings.join(" | "),
      });
    }
  }

  return missing;
}

export function readBaseTrame(rawText: string): BaseTrame {
  const sections = splitIntoSections(rawText);
  const dimensionBlueprints = DIAGNOSTIC_DIMENSIONS.map((dimension) =>
    buildDimensionBlueprint(dimension.id, sections)
  );
  const structureValidation = buildStructureValidation(dimensionBlueprints);

  if (!structureValidation.isValid) {
    throw new Error(`TRAME_STRUCTURE_INVALID: ${structureValidation.message}`);
  }

  const qualityFlags = deriveQualityFlags(rawText, dimensionBlueprints);
  const missingFields = deriveMissingFields(dimensionBlueprints);

  const snapshot: BaseTrameSnapshot = {
    rawText: String(rawText ?? ""),
    sections,
    qualityFlags,
    missingFields,
    extractedAt: new Date().toISOString(),
    dimensionBlueprints,
    structureValidation,
  };

  return snapshot as BaseTrame;
}

export type {
  BaseTrame,
  BaseTrameSnapshot,
  MissingFieldSignal,
  QualityFlag,
  TrameSection,
};
