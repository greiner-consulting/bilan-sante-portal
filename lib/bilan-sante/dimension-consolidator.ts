// lib/bilan-sante/dimension-consolidator.ts

import { dimensionTitle, type DimensionId } from "@/lib/bilan-sante/protocol";
import type {
  DiagnosticSignal,
  DimensionAnalysisSnapshot,
  DimensionFact,
  DimensionFactNature,
  FrozenDimensionDiagnosis,
  ObjectiveSeed,
  RootCauseHypothesis,
  SwotItem,
  SwotSnapshot,
  ZoneNonPilotee,
} from "@/lib/bilan-sante/session-model";

type ConsolidationInput = {
  dimensionId: DimensionId;
  facts: DimensionFact[];
  signals: DiagnosticSignal[];
  generatedAt?: string;
};

type LegacyLikeProgress =
  | "identified"
  | "questioned"
  | "illustrated"
  | "quantified"
  | "causalized"
  | "arbitrated"
  | "stabilized"
  | "consolidated";

type LegacyLikeFact = DimensionFact & {
  progress?: LegacyLikeProgress;
  evidence_refs?: string[];
  contradiction_notes?: string[];
  missing_angles?: string[];
  asked_angles?: string[];
  observed_element?: string;
  managerial_risk?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function truncate(text: string, max = 220): string {
  const clean = cleanText(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function firstSentence(value: unknown, max = 200): string {
  const text = cleanText(value);
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return truncate(cleanText(match?.[1] ?? text), max);
}

function lowerSentence(value: string): string {
  const text = cleanText(value);
  if (!text) return "";
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function hashString(input: string): string {
  let hash = 0;

  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function containsAny(text: string, patterns: string[]): boolean {
  const haystack = normalizeText(text);
  return patterns.some((pattern) => haystack.includes(normalizeText(pattern)));
}

function asLegacyLikeFact(fact: DimensionFact): LegacyLikeFact {
  return fact as LegacyLikeFact;
}

function progressRank(progress?: LegacyLikeProgress): number {
  switch (progress) {
    case "consolidated":
      return 8;
    case "stabilized":
      return 7;
    case "arbitrated":
      return 6;
    case "causalized":
      return 5;
    case "quantified":
      return 4;
    case "illustrated":
      return 3;
    case "questioned":
      return 2;
    case "identified":
      return 1;
    default:
      return 0;
  }
}

function consolidationScore(fact: DimensionFact): number {
  const legacy = asLegacyLikeFact(fact);

  const progressScore = progressRank(legacy.progress) * 25;
  const criticality = Number(fact.priorityScore ?? 0);
  const confidence = Number(fact.confidenceScore ?? 0);
  const evidenceBonus = Math.min(
    (legacy.evidence_refs?.length ?? fact.sources?.length ?? 0) * 6,
    18
  );
  const contradictionPenalty = Math.min((legacy.contradiction_notes?.length ?? 0) * 10, 25);
  const missingPenalty = Math.min((legacy.missing_angles?.length ?? 0) * 6, 24);

  return progressScore + criticality + confidence + evidenceBonus - contradictionPenalty - missingPenalty;
}

function makeRootCauseId(dimensionId: DimensionId, label: string): string {
  return `rc-d${dimensionId}-${hashString(label)}`;
}

function makeObjectiveSeedId(dimensionId: DimensionId, label: string): string {
  return `obj-seed-d${dimensionId}-${hashString(label)}`;
}

function sortFactsForConsolidation(facts: DimensionFact[]): DimensionFact[] {
  return [...facts].sort((a, b) => consolidationScore(b) - consolidationScore(a));
}

function topFactsByNature(
  facts: DimensionFact[],
  natures: DimensionFactNature[],
  limit: number
): DimensionFact[] {
  return sortFactsForConsolidation(facts)
    .filter((fact) => natures.includes(fact.nature))
    .slice(0, limit);
}

function signalForTheme(
  signals: DiagnosticSignal[],
  theme: string
): DiagnosticSignal | undefined {
  const key = normalizeText(theme);
  return signals.find((signal) => normalizeText(signal.theme) === key);
}

function fallbackRiskFromTheme(theme: string): string {
  const lower = normalizeText(theme);

  if (lower.includes("prix") || lower.includes("marge")) {
    return "Risque de décisions de prix ou de marge prises sans cadre assez robuste, avec dérive silencieuse de rentabilité.";
  }

  if (lower.includes("cash")) {
    return "Risque de pilotage économique trop tardif ou incomplet, avec tension de trésorerie ou dérive non anticipée.";
  }

  if (lower.includes("commercial") || lower.includes("marche")) {
    return "Risque de développement commercial insuffisamment piloté, avec sélectivité faible ou croissance peu rentable.";
  }

  if (
    lower.includes("role") ||
    lower.includes("responsabilite") ||
    lower.includes("equipe") ||
    lower.includes("rh")
  ) {
    return "Risque de fonctionnement trop dépendant des personnes, de responsabilités floues ou de chaîne managériale insuffisamment tenue.";
  }

  if (
    lower.includes("indicateur") ||
    lower.includes("tableau de bord") ||
    lower.includes("rituel") ||
    lower.includes("pilotage")
  ) {
    return "Risque de dérive non détectée à temps, faute de repères utiles, de rituels tenus ou d’alertes managériales fiables.";
  }

  return "Risque de pilotage insuffisamment explicite, avec arbitrages tardifs, coordination fragile et dérives peu visibles à temps.";
}

function fallbackConsequenceFromTheme(theme: string): string {
  const lower = normalizeText(theme);

  if (lower.includes("prix") || lower.includes("marge")) {
    return "Érosion progressive de marge, décisions mal calibrées et difficulté à corriger les dérives une fois les affaires engagées.";
  }

  if (lower.includes("cash")) {
    return "Visibilité économique dégradée, tension de trésorerie et correction tardive des écarts.";
  }

  if (lower.includes("commercial") || lower.includes("client")) {
    return "Croissance irrégulière, pipeline peu fiable ou développement commercial insuffisamment sélectif.";
  }

  if (
    lower.includes("role") ||
    lower.includes("responsabilite") ||
    lower.includes("equipe") ||
    lower.includes("rh")
  ) {
    return "Surcharge sur quelques acteurs clés, fragilité d’exécution et difficulté à tenir durablement la trajectoire.";
  }

  return "Dégradation progressive de la tenue des engagements, de la qualité des arbitrages ou de la robustesse d’exécution.";
}

function supportingEvidenceForFact(
  fact: DimensionFact,
  signals: DiagnosticSignal[]
): string {
  const signal = signalForTheme(signals, fact.theme);
  const evidence = firstSentence(fact.evidence, 180);
  if (evidence) return evidence;

  const source = firstSentence((fact.sources ?? [])[0], 180);
  if (source) return source;

  const excerpt = firstSentence(signal?.sourceExcerpt, 180);
  if (excerpt) return excerpt;

  return firstSentence(fact.statement, 180);
}

function buildZoneFromFact(
  fact: DimensionFact,
  signals: DiagnosticSignal[]
): ZoneNonPilotee {
  const supportingSignal = signalForTheme(signals, fact.theme);

  return {
    constat: firstSentence(fact.statement, 220),
    risqueManagerial:
      firstSentence(supportingSignal?.managerialRisk, 220) || fallbackRiskFromTheme(fact.theme),
    consequence:
      firstSentence(supportingSignal?.probableConsequence, 220) || fallbackConsequenceFromTheme(fact.theme),
  };
}

function deterministicConstatFromFact(
  fact: DimensionFact,
  signals: DiagnosticSignal[]
): string {
  const legacy = asLegacyLikeFact(fact);
  const observed = firstSentence(legacy.observed_element ?? fact.statement, 170);
  const supportingSignal = signalForTheme(signals, fact.theme);
  const risk =
    firstSentence(legacy.managerial_risk, 200) ||
    firstSentence(supportingSignal?.managerialRisk, 200) ||
    fallbackRiskFromTheme(fact.theme);
  const evidence = supportingEvidenceForFact(fact, signals);

  if (legacy.progress === "stabilized" || legacy.progress === "consolidated") {
    return `${observed} La matière disponible montre aussi ${lowerSentence(
      evidence
    )}, ce qui rend le risque désormais suffisamment étayé pour orienter la priorité d’action.`;
  }

  if (legacy.progress === "arbitrated") {
    return `${observed} La matière recueillie montre aussi ${lowerSentence(
      evidence
    )} ; le sujet relève donc moins d’un incident ponctuel que d’un arbitrage insuffisamment tenu.`;
  }

  if (legacy.progress === "causalized") {
    return `${observed} Les éléments convergent aussi vers ${lowerSentence(
      evidence
    )}, ce qui renvoie à un mécanisme de fond insuffisamment maîtrisé.`;
  }

  if (legacy.progress === "quantified" || legacy.progress === "illustrated") {
    return `${observed} Le point est désormais objectivé, notamment parce que ${lowerSentence(
      evidence
    )}, et il révèle ${lowerSentence(risk)}.`;
  }

  return `${observed} La matière disponible montre aussi ${lowerSentence(
    evidence
  )}, ce qui expose à ${lowerSentence(risk)}.`;
}

function buildEvidenceSummary(
  facts: DimensionFact[],
  signals: DiagnosticSignal[]
): string[] {
  const prioritized = sortFactsForConsolidation(facts).slice(0, 4);
  const items = prioritized.map((fact) => {
    const theme = cleanText(fact.theme);
    const evidence = supportingEvidenceForFact(fact, signals);
    return `${theme} — ${evidence}`;
  });

  return uniqueStrings(items.map((item) => truncate(item, 180))).slice(0, 4);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    const key = normalizeText(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function buildKeyFindings(
  dimensionId: DimensionId,
  facts: DimensionFact[],
  signals: DiagnosticSignal[]
): string[] {
  const prioritized = sortFactsForConsolidation(facts);
  const weaknesses = prioritized.filter((fact) =>
    ["gap", "weakness", "impact", "cause"].includes(fact.nature)
  );

  const selected = (weaknesses.length > 0 ? weaknesses : prioritized).slice(0, 3);

  const findings = selected.map((fact) => {
    const deterministic = deterministicConstatFromFact(fact, signals);
    return `${dimensionTitle(dimensionId)} — ${deterministic}`;
  });

  while (findings.length < 3) {
    findings.push(
      `${dimensionTitle(dimensionId)} — Plusieurs sujets restent partiellement documentés ou encore trop dépendants d’usages implicites, ce qui limite la robustesse du pilotage.`
    );
  }

  return findings.slice(0, 3).map((item) => truncate(item, 260));
}

function deterministicCauseFromFacts(
  dimensionId: DimensionId,
  facts: DimensionFact[],
  signals: DiagnosticSignal[]
): RootCauseHypothesis[] {
  const prioritized = sortFactsForConsolidation(facts);
  const strongest = prioritized[0];
  const nextFacts = prioritized.slice(1, 3);

  if (!strongest) {
    const confidenceScore = 52;
    return [
      {
        id: makeRootCauseId(
          dimensionId,
          "Défaut de pilotage structuré et d’arbitrage explicite"
        ),
        label: "Défaut de pilotage structuré et d’arbitrage explicite",
        rationale:
          "La matière disponible reste partielle, mais elle suggère avant tout un déficit de structuration du pilotage, de clarification des responsabilités et d’arbitrage explicite.",
        supportingFactIds: [],
        opposingFactIds: [],
        confidence: confidenceScore / 100,
        confidenceScore,
      },
    ];
  }

  const legacy = asLegacyLikeFact(strongest);
  const theme = strongest.theme;
  const observed = firstSentence(legacy.observed_element ?? strongest.statement, 170);
  const supportIds = [strongest.id, ...nextFacts.map((fact) => fact.id)];
  const evidence = supportingEvidenceForFact(strongest, signals);

  if (legacy.progress === "arbitrated" || legacy.progress === "stabilized") {
    const confidenceScore = Math.max(62, Math.min(88, strongest.confidenceScore ?? 0));
    return [
      {
        id: makeRootCauseId(
          dimensionId,
          `Arbitrages insuffisamment structurés sur "${theme}"`
        ),
        label: `Arbitrages insuffisamment structurés sur "${theme}"`,
        rationale: `Les éléments les plus solides montrent que ${lowerSentence(
          observed
        )} et que ${lowerSentence(
          evidence
        )}. La difficulté dominante tient donc à des arbitrages trop implicites, tardifs ou insuffisamment tenus.`,
        supportingFactIds: supportIds,
        opposingFactIds: [],
        confidence: confidenceScore / 100,
        confidenceScore,
      },
    ];
  }

  if (legacy.progress === "causalized") {
    const confidenceScore = Math.max(60, Math.min(85, strongest.confidenceScore ?? 0));
    return [
      {
        id: makeRootCauseId(
          dimensionId,
          `Mécanisme de pilotage insuffisamment maîtrisé sur "${theme}"`
        ),
        label: `Mécanisme de pilotage insuffisamment maîtrisé sur "${theme}"`,
        rationale: `La matière consolidée suggère que ${lowerSentence(
          observed
        )} et que ${lowerSentence(
          evidence
        )}. Le sujet renvoie donc à un mécanisme récurrent de pilotage insuffisamment maîtrisé.`,
        supportingFactIds: supportIds,
        opposingFactIds: [],
        confidence: confidenceScore / 100,
        confidenceScore,
      },
    ];
  }

  const confidenceScore = Math.max(56, Math.min(78, strongest.confidenceScore ?? 0));
  return [
    {
      id: makeRootCauseId(
        dimensionId,
        `Pilotage insuffisamment tenu sur "${theme}"`
      ),
      label: `Pilotage insuffisamment tenu sur "${theme}"`,
      rationale: truncate(
        `La cause dominante semble liée au thème "${theme}" : ${lowerSentence(
          observed
        )}. La matière disponible montre aussi ${lowerSentence(
          evidence
        )}, ce qui renvoie avant tout à un pilotage insuffisamment explicite, cadré ou tenu dans la durée.`,
        240
      ),
      supportingFactIds: supportIds,
      opposingFactIds: [],
      confidence: confidenceScore / 100,
      confidenceScore,
    },
  ];
}

function buildRootCauseHypotheses(
  dimensionId: DimensionId,
  facts: DimensionFact[],
  signals: DiagnosticSignal[]
): RootCauseHypothesis[] {
  const explicitCauseFacts = topFactsByNature(facts, ["cause"], 3);

  if (explicitCauseFacts.length > 0) {
    return explicitCauseFacts.map((fact) => {
      const confidenceScore = Math.max(55, Math.min(90, fact.confidenceScore ?? 0));
      return {
        id: makeRootCauseId(dimensionId, fact.statement),
        label: truncate(fact.statement.replace(/^.+?—\s*/, ""), 140),
        rationale: `Hypothèse étayée par la matière collectée sur le thème "${fact.theme}" et recoupée avec les signaux disponibles, notamment : ${lowerSentence(
          supportingEvidenceForFact(fact, signals)
        )}.`,
        supportingFactIds: [fact.id],
        opposingFactIds: [],
        confidence: confidenceScore / 100,
        confidenceScore,
      };
    });
  }

  return deterministicCauseFromFacts(dimensionId, facts, signals);
}

function isPositiveFact(fact: DimensionFact): boolean {
  if (fact.nature === "strength" || fact.nature === "practice") return true;

  return containsAny(fact.statement, [
    "bien en place",
    "solide",
    "maitrise",
    "maîtrise",
    "rituel en place",
    "cadre en place",
    "documente",
    "documenté",
  ]);
}

function buildSwotItemsFromFacts(
  dimensionId: DimensionId,
  facts: DimensionFact[],
  natures: DimensionFactNature[],
  quadrant: "strength" | "weakness" | "opportunity" | "threat",
  family: "s" | "w" | "o" | "t",
  limit: number
): SwotItem[] {
  void dimensionId;
  void family;

  return topFactsByNature(facts, natures, limit).map((fact) => ({
    quadrant,
    label: truncate(fact.statement.replace(/^.+?—\s*/, ""), 140),
    detail: truncate(supportingEvidenceForFact(fact, []), 220) || truncate(fact.statement, 220),
    rationale: `Élément dérivé du thème "${fact.theme}" à partir de la matière recueillie.`,
    supportingFactIds: [fact.id],
    priorityScore: fact.priorityScore ?? 0,
  }));
}

function buildObjectiveLabelFromFact(fact: DimensionFact): string {
  const text = normalizeText(fact.statement);

  if (containsAny(text, ["formalis", "document", "cadre"])) {
    return `Formaliser et fiabiliser le pilotage du thème "${fact.theme}"`;
  }

  if (containsAny(text, ["depend", "clé", "centralis"])) {
    return `Réduire la dépendance et clarifier les arbitrages sur "${fact.theme}"`;
  }

  if (containsAny(text, ["prix", "marge", "cash", "rentabilite"])) {
    return `Sécuriser le pilotage économique du thème "${fact.theme}"`;
  }

  if (containsAny(text, ["indicateur", "suivi", "tableau de bord"])) {
    return `Mettre sous pilotage le thème "${fact.theme}" avec des indicateurs utiles`;
  }

  return `Structurer et sécuriser le thème "${fact.theme}"`;
}

function buildIndicatorFromFact(fact: DimensionFact): string {
  const theme = normalizeText(fact.theme);

  if (theme.includes("commercial") || theme.includes("marche")) {
    return "Taux de transformation, volume d’opportunités actives, marge des affaires signées";
  }

  if (theme.includes("prix") || theme.includes("marge")) {
    return "Écart prix vendu / coût réel, marge à affaire, taux de dérive devis";
  }

  if (theme.includes("cash")) {
    return "Prévision de cash, encours, délai de facturation et de recouvrement";
  }

  if (theme.includes("equipe") || theme.includes("role") || theme.includes("rh")) {
    return "Couverture des rôles clés, stabilité des équipes, niveau de dépendance sur personnes clés";
  }

  return "Indicateur de maîtrise du thème, fréquence de revue, taux de traitement des écarts";
}

function buildQuickWinFromFact(fact: DimensionFact): string {
  const text = normalizeText(fact.statement);

  if (containsAny(text, ["formalis", "document"])) {
    return `Écrire sous 15 jours une règle simple et un support de référence sur "${fact.theme}".`;
  }

  if (containsAny(text, ["indicateur", "suivi", "tableau de bord"])) {
    return `Définir 3 indicateurs utiles et un rituel de revue court sur "${fact.theme}".`;
  }

  if (containsAny(text, ["depend", "centralis", "arbitrage"])) {
    return `Clarifier immédiatement qui décide, qui valide et quand sur "${fact.theme}".`;
  }

  return `Sécuriser un premier point concret et visible sur "${fact.theme}" dans le mois.`;
}

function buildObjectiveSeeds(
  dimensionId: DimensionId,
  facts: DimensionFact[],
  rootCauses: RootCauseHypothesis[]
): ObjectiveSeed[] {
  void rootCauses;

  const seedFacts = topFactsByNature(
    facts,
    ["opportunity", "gap", "weakness", "impact"],
    5
  );

  return seedFacts.map((fact, index) => ({
    id: makeObjectiveSeedId(dimensionId, `${fact.statement}-${index + 1}`),
    label: buildObjectiveLabelFromFact(fact),
    rationale: `Axe proposé à partir de la matière collectée sur "${fact.theme}" et de la consolidation de la dimension.`,
    owner: "Dirigeant / responsable de dimension",
    indicator: buildIndicatorFromFact(fact),
    horizon: "90 jours",
    linkedFactIds: [fact.id],
    priorityScore: fact.priorityScore ?? 0,
    suggestedDueDate: "À définir avec le dirigeant",
    potentialGain: "À qualifier lors de la validation finale, sans chiffrage inventé",
    quickWin: buildQuickWinFromFact(fact),
  }));
}

function buildSwotSnapshot(
  dimensionId: DimensionId,
  facts: DimensionFact[],
  objectiveSeeds: ObjectiveSeed[]
): SwotSnapshot {
  const strengths = buildSwotItemsFromFacts(
    dimensionId,
    facts.filter(isPositiveFact),
    ["strength", "practice", "other"],
    "strength",
    "s",
    3
  ).slice(0, 3);

  const weaknesses = buildSwotItemsFromFacts(
    dimensionId,
    facts,
    ["gap", "weakness"],
    "weakness",
    "w",
    3
  );

  const opportunities: SwotItem[] = objectiveSeeds.slice(0, 3).map((seed) => ({
    quadrant: "opportunity",
    label: seed.label,
    detail: seed.quickWin,
    rationale:
      "Opportunité d’amélioration issue des axes d’action pressentis sur la dimension.",
    supportingFactIds: seed.linkedFactIds,
    priorityScore: seed.priorityScore ?? 0,
  }));

  const threats = buildSwotItemsFromFacts(
    dimensionId,
    facts,
    ["impact", "weakness", "gap"],
    "threat",
    "t",
    3
  );

  return {
    strengths,
    weaknesses,
    opportunities,
    threats,
  };
}

function deterministicZonesFromFacts(
  facts: DimensionFact[],
  signals: DiagnosticSignal[]
): ZoneNonPilotee[] {
  const prioritized = sortFactsForConsolidation(facts);

  const unstableFacts = prioritized.filter((fact) => {
    const legacy = asLegacyLikeFact(fact);
    const hasMissingAngles = (legacy.missing_angles?.length ?? 0) > 0;
    const hasContradictions = (legacy.contradiction_notes?.length ?? 0) > 0;

    return (
      fact.nature === "gap" ||
      fact.nature === "weakness" ||
      fact.nature === "impact" ||
      hasMissingAngles ||
      hasContradictions
    );
  });

  return unstableFacts.slice(0, 3).map((fact) => buildZoneFromFact(fact, signals));
}

function buildAnalysisSummary(
  dimensionId: DimensionId,
  facts: DimensionFact[],
  rootCauses: RootCauseHypothesis[],
  nonPilotedAreas: ZoneNonPilotee[]
): string {
  const strongest = sortFactsForConsolidation(facts)[0];
  const rootCause = rootCauses[0]?.label;
  const zone = nonPilotedAreas[0]?.constat;
  const evidence = strongest ? supportingEvidenceForFact(strongest, []) : "";

  return truncate(
    [
      `Dimension ${dimensionId} (${dimensionTitle(dimensionId)}) :`,
      strongest ? `point dominant "${strongest.theme}"` : "plusieurs sujets structurants",
      rootCause ? `cause racine probable "${rootCause}"` : "",
      zone ? `zone non pilotée prioritaire "${zone}"` : "",
      evidence ? `matière saillante "${evidence}"` : "",
    ]
      .filter(Boolean)
      .join(" — "),
    340
  );
}

function conservativeScore(
  facts: DimensionFact[],
  signals: DiagnosticSignal[]
): 1 | 2 | 3 | 4 | 5 {
  if (facts.length === 0 && signals.length === 0) return 2;

  const weakFacts = facts.filter((fact) =>
    ["gap", "weakness", "impact"].includes(fact.nature)
  );

  const avgWeakPriority =
    weakFacts.length > 0
      ? weakFacts.reduce((sum, fact) => sum + (fact.priorityScore ?? 0), 0) / weakFacts.length
      : 70;

  const absenceRatio =
    signals.length > 0
      ? signals.filter((signal) => signal.signalKind === "absence").length / signals.length
      : 0.25;

  const raw = 5 - Math.round((avgWeakPriority / 100) * 2 + absenceRatio * 2);
  const clamped = Math.max(1, Math.min(5, raw));

  return clamped as 1 | 2 | 3 | 4 | 5;
}

function asTuple3(items: string[]): [string, string, string] {
  const buffer = [...items];

  while (buffer.length < 3) {
    buffer.push(
      "Un ensemble de sujets reste partiellement documenté ou trop implicite, ce qui limite la robustesse de la consolidation."
    );
  }

  return [buffer[0], buffer[1], buffer[2]];
}

export function consolidateDimensionMaterial(
  params: ConsolidationInput
): DimensionAnalysisSnapshot {
  const generatedAt = params.generatedAt ?? nowIso();
  const facts = sortFactsForConsolidation(params.facts);
  const signals = [...params.signals];

  const rootCauseHypotheses = buildRootCauseHypotheses(
    params.dimensionId,
    facts,
    signals
  );

  const nonPilotedAreas = deterministicZonesFromFacts(facts, signals);
  const objectiveSeeds = buildObjectiveSeeds(
    params.dimensionId,
    facts,
    rootCauseHypotheses
  );
  const swot = buildSwotSnapshot(params.dimensionId, facts, objectiveSeeds);
  const keyFindings = buildKeyFindings(params.dimensionId, facts, signals);
  const evidenceSummary = buildEvidenceSummary(facts, signals);
  const summary = buildAnalysisSummary(
    params.dimensionId,
    facts,
    rootCauseHypotheses,
    nonPilotedAreas
  );

  return {
    dimensionId: params.dimensionId,
    score: conservativeScore(facts, signals),
    summary,
    evidenceSummary: evidenceSummary.length > 0 ? evidenceSummary : [summary],
    keyFindings,
    nonPilotedAreas:
      nonPilotedAreas.length > 0
        ? nonPilotedAreas
        : [
            {
              constat:
                "Peu de zones massives apparaissent, mais plusieurs sujets restent encore insuffisamment stabilisés.",
              risqueManagerial:
                "Risque de dérive progressive sans cadre managérial suffisamment explicite.",
              consequence:
                "Dégradation lente de la coordination, de la visibilité ou de la tenue des engagements.",
            },
          ],
    facts,
    rootCauseHypotheses,
    swot,
    objectiveSeeds,
    generatedAt,
  };
}

export function buildFrozenDimensionFromConsolidation(params: {
  dimensionId: DimensionId;
  signals: DiagnosticSignal[];
  consolidation: DimensionAnalysisSnapshot;
  frozenAt?: string;
}): FrozenDimensionDiagnosis {
  const frozenAt = params.frozenAt ?? nowIso();
  const consolidationFacts = params.consolidation.facts ?? [];
  const keyFindings = params.consolidation.keyFindings ?? [];
  const nonPilotedAreas = params.consolidation.nonPilotedAreas ?? [];
  const rootCauseHypotheses = params.consolidation.rootCauseHypotheses ?? [];
  const swot: SwotSnapshot = params.consolidation.swot ?? {
    strengths: [],
    weaknesses: [],
    opportunities: [],
    threats: [],
  };
  const objectiveSeeds = params.consolidation.objectiveSeeds ?? [];
  const evidenceSummary = params.consolidation.evidenceSummary ?? buildEvidenceSummary(consolidationFacts, params.signals);

  const keyFacts = sortFactsForConsolidation(consolidationFacts)
    .filter((fact) => ["gap", "weakness", "impact", "cause"].includes(fact.nature))
    .slice(0, 3);

  return {
    dimensionId: params.dimensionId,
    score: conservativeScore(consolidationFacts, params.signals),
    consolidatedFindings: asTuple3(keyFindings.slice(0, 3)),
    dominantRootCause:
      rootCauseHypotheses[0]?.label ??
      "Écarts entre fonctionnement réel, responsabilités tenues et cadre de pilotage attendu.",
    unmanagedZones: nonPilotedAreas.slice(0, 3),
    frozenAt,
    summary: params.consolidation.summary,
    evidenceSummary,
    keyFindings,
    nonPilotedAreas,
    keyFactIds: keyFacts.map((fact) => fact.id),
    rootCauseHypotheses,
    swot,
    objectiveSeeds,
    analysisSnapshot: params.consolidation,
  };
}
