import type {
  FinalObjective,
  FinalObjectiveDecisionTrace,
  FinalObjectiveSet,
  FrozenDimensionDiagnosis,
  ObjectiveSeed,
  ZoneNonPilotee,
} from "@/lib/bilan-sante/session-model";
import { FINAL_OBJECTIVES_HEADER, dimensionTitle } from "@/lib/bilan-sante/protocol";

export type ObjectiveDecisionStatus = "validated" | "adjusted" | "refused";

export type ObjectiveDecisionInput = {
  objectiveId: string;
  status: ObjectiveDecisionStatus;
  adjustedLabel?: string;
  adjustedIndicator?: string;
  adjustedDueDate?: string;
  adjustedPotentialGain?: string;
  adjustedQuickWin?: string;
};

type ObjectiveStrategyId =
  | "arbitration"
  | "dependency"
  | "pricing"
  | "cash"
  | "commercial"
  | "roles"
  | "formalization"
  | "execution"
  | "generic";

type ObjectiveStrategy = {
  id: ObjectiveStrategyId;
  indicator: string;
  quickWin: string;
  dueDate: string;
  potentialGainPrefix: string;
  gainHypotheses: string[];
};

const DEFAULT_OBJECTIVE_OWNER = "Dirigeant / responsable de dimension";
const DEFAULT_DUE_DATE = "À définir avec le dirigeant";
const DEFAULT_POTENTIAL_GAIN =
  "Fourchette prudente à estimer lors de l’itération finale selon données disponibles";

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: unknown): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeEvidenceSummary(value: unknown): string {
  if (Array.isArray(value)) return normalizeText(value.join(" "));
  return normalizeText(value);
}

function truncate(value: string, max = 180): string {
  const text = normalizeText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const text = normalizeText(item);
    if (!text) continue;
    const key = normalizeForMatch(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function extractThemeFromText(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/th[èe]me\s*["«]([^"»]+)["»]/i);
  return match?.[1] ? normalizeText(match[1]) : null;
}

function firstSentence(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return normalizeText(match?.[1] ?? text);
}

function dominantZone(frozen: FrozenDimensionDiagnosis): ZoneNonPilotee | null {
  return frozen.unmanagedZones?.[0] ?? null;
}

function secondaryZone(frozen: FrozenDimensionDiagnosis): ZoneNonPilotee | null {
  return frozen.unmanagedZones?.[1] ?? frozen.unmanagedZones?.[0] ?? null;
}

function zoneLabelFromZone(zone: ZoneNonPilotee | null, fallback = "zone non pilotée dominante"): string {
  if (!zone) return fallback;
  const theme = extractThemeFromText(zone.constat);
  if (theme) return theme;
  return truncate(firstSentence(zone.constat), 110) || fallback;
}

function dominantZoneLabel(frozen: FrozenDimensionDiagnosis): string {
  return zoneLabelFromZone(dominantZone(frozen));
}

function secondaryZoneLabel(frozen: FrozenDimensionDiagnosis): string {
  return zoneLabelFromZone(secondaryZone(frozen), dominantZoneLabel(frozen));
}

function textContainsAny(text: string, patterns: string[]): boolean {
  const haystack = normalizeForMatch(text);
  return patterns.some((pattern) => haystack.includes(normalizeForMatch(pattern)));
}

function frozenDiagnosticText(frozen: FrozenDimensionDiagnosis): string {
  return normalizeText(
    [
      frozen.summary,
      frozen.dominantRootCause,
      ...(frozen.consolidatedFindings ?? []),
      ...(frozen.evidenceSummary ?? []),
      ...(frozen.unmanagedZones ?? []).flatMap((zone) => [
        zone.constat,
        zone.risqueManagerial,
        zone.consequence,
      ]),
      ...(frozen.objectiveSeeds ?? []).flatMap((seed) => [
        seed.label,
        seed.rationale,
        seed.indicator,
        seed.quickWin,
      ]),
    ].join(" ")
  );
}

function pickObjectiveStrategyId(frozen: FrozenDimensionDiagnosis): ObjectiveStrategyId {
  const text = frozenDiagnosticText(frozen);

  if (textContainsAny(text, ["arbitrage", "validation", "décide", "decide", "comité", "comite"])) {
    return "arbitration";
  }
  if (textContainsAny(text, ["dépend", "depend", "personne clé", "personne cle", "relais", "goulot"])) {
    return "dependency";
  }
  if (textContainsAny(text, ["prix", "devis", "coût", "cout", "marge", "chiffrage", "rentabilité", "rentabilite"])) {
    return "pricing";
  }
  if (textContainsAny(text, ["cash", "trésorerie", "tresorerie", "recouvrement", "facturation", "encours"])) {
    return "cash";
  }
  if (textContainsAny(text, ["pipeline", "commercial", "marché", "marche", "taux de transformation", "opportunit"])) {
    return "commercial";
  }
  if (textContainsAny(text, ["rôle", "role", "responsabilit", "organigramme", "encadrement", "équipe", "equipe"])) {
    return "roles";
  }
  if (textContainsAny(text, ["rituel", "indicateur", "cadre", "pilotage", "formalis", "non suivi", "non document"])) {
    return "formalization";
  }
  if (textContainsAny(text, ["qualité", "qualite", "performance", "productivité", "productivite", "planification", "exécution", "execution", "non-qualité"])) {
    return "execution";
  }
  return "generic";
}

function objectiveStrategy(frozen: FrozenDimensionDiagnosis): ObjectiveStrategy {
  switch (pickObjectiveStrategyId(frozen)) {
    case "arbitration":
      return {
        id: "arbitration",
        indicator: "Délai d’arbitrage, taux de décisions prises au bon niveau, nombre de sujets en attente de validation au-delà du délai cible",
        quickWin: "Sous 30 jours, clarifier qui décide, qui valide et sous quel délai sur le point dominant.",
        dueDate: "90 jours pour remettre sous contrôle la chaîne de décision",
        potentialGainPrefix: "Réduction des blocages, décisions plus rapides et exécution plus fluide sur les points critiques.",
        gainHypotheses: [
          "Le gain dépendra de la réduction du délai d’arbitrage et de la baisse des sujets en attente.",
          "Le gain sera visible si les décisions redescendent au bon niveau sans escalade excessive.",
        ],
      };
    case "dependency":
      return {
        id: "dependency",
        indicator: "Taux de couverture des relais, nombre de points tenus sans personne clé, niveau de dépendance critique sur les sujets dominants",
        quickWin: "Identifier immédiatement la dépendance principale et formaliser un relais opérationnel ou décisionnel.",
        dueDate: "90 jours pour réduire la dépendance critique la plus exposée",
        potentialGainPrefix: "Réduction du risque de rupture, meilleure continuité de pilotage et moindre exposition sur les personnes clés.",
        gainHypotheses: [
          "Le gain dépendra de la capacité à transférer les points critiques à des relais identifiés.",
          "Le gain sera tangible si le fonctionnement tient en l’absence de la personne aujourd’hui centrale.",
        ],
      };
    case "pricing":
      return {
        id: "pricing",
        indicator: "Écart devis / coût réel, marge à affaire, taux d’affaires re-challengées avant engagement, dérive de marge après exécution",
        quickWin: "Sécuriser sous 30 jours un contrôle simple des hypothèses de prix et des écarts coût réel sur les affaires sensibles.",
        dueDate: "90 jours pour fiabiliser le pilotage prix / marge",
        potentialGainPrefix: "Sécurisation de la marge, réduction des écarts de chiffrage et meilleure sélectivité commerciale.",
        gainHypotheses: [
          "Le gain dépendra de la baisse des écarts entre prix vendu et coût réel.",
          "Le gain sera visible si les affaires non rentables sont mieux détectées avant engagement.",
        ],
      };
    case "cash":
      return {
        id: "cash",
        indicator: "Prévision de cash à 8 semaines, encours échus, délai de facturation, délai de recouvrement",
        quickWin: "Mettre en place sous 30 jours un point cash court avec encours, facturation et recouvrement sur les sujets prioritaires.",
        dueDate: "90 jours pour remettre sous pilotage la conversion cash",
        potentialGainPrefix: "Amélioration de la visibilité cash, réduction des encours anciens et moindre tension de trésorerie.",
        gainHypotheses: [
          "Le gain dépendra de la réduction des retards de facturation et de recouvrement.",
          "Le gain sera visible si la prévision cash devient fiable et utilisée dans les arbitrages.",
        ],
      };
    case "commercial":
      return {
        id: "commercial",
        indicator: "Taux de transformation, volume de pipeline qualifié, marge des affaires signées, taux d’affaires écartées non rentables",
        quickWin: "Installer sous 30 jours une revue pipeline courte distinguant volume, qualité, sélectivité et marge attendue.",
        dueDate: "90 jours pour rendre le pilotage commercial plus sélectif et plus rentable",
        potentialGainPrefix: "Meilleure visibilité commerciale, transformation plus sélective et croissance plus rentable.",
        gainHypotheses: [
          "Le gain dépendra de la qualité réelle du pipeline et de la discipline de sélection des affaires.",
          "Le gain sera visible si la marge des affaires signées progresse sans dégrader le volume utile.",
        ],
      };
    case "roles":
      return {
        id: "roles",
        indicator: "Couverture des rôles clés, taux de sujets avec responsable explicite, délai de décision sur les sujets transverses",
        quickWin: "Sous 30 jours, clarifier les responsabilités sur le point dominant et rendre visible le responsable de chaque arbitrage clé.",
        dueDate: "90 jours pour clarifier les rôles et fiabiliser l’encadrement",
        potentialGainPrefix: "Moins de flou de responsabilité, décisions plus rapides et meilleure tenue de l’exécution.",
        gainHypotheses: [
          "Le gain dépendra de la clarification des rôles sur les sujets aujourd’hui ambigus ou centralisés.",
          "Le gain sera visible si les sujets ne remontent plus systématiquement faute de propriétaire clair.",
        ],
      };
    case "formalization":
      return {
        id: "formalization",
        indicator: "Nombre de rituels tenus, taux de sujets suivis avec indicateur, taux d’écarts revus et traités dans le délai prévu",
        quickWin: "Poser sous 30 jours une règle simple, un rituel court et 3 indicateurs utiles sur le point dominant.",
        dueDate: "90 jours pour sortir du pilotage implicite sur le sujet dominant",
        potentialGainPrefix: "Pilotage plus explicite, écarts plus visibles et meilleure capacité de réaction managériale.",
        gainHypotheses: [
          "Le gain dépendra de la régularité des rituels et de l’usage réel des indicateurs.",
          "Le gain sera visible si les écarts sont détectés et traités plus tôt qu’aujourd’hui.",
        ],
      };
    case "execution":
      return {
        id: "execution",
        indicator: "Taux de dérive planning / coût, productivité, taux de non-qualité, volume de reprises ou d’écarts terrain",
        quickWin: "Mettre sous revue hebdomadaire les dérives visibles sur le point dominant avec un propriétaire et un plan d’action court.",
        dueDate: "90 jours pour remettre sous contrôle l’exécution sur le point dominant",
        potentialGainPrefix: "Moindre dérive opérationnelle, meilleure tenue des engagements et réduction des non-qualités ou reprises.",
        gainHypotheses: [
          "Le gain dépendra de la baisse des dérives opérationnelles visibles sur le point dominant.",
          "Le gain sera visible si les écarts terrain sont traités plus tôt et plus systématiquement.",
        ],
      };
    case "generic":
    default:
      return {
        id: "generic",
        indicator: "Indicateur de maîtrise du thème, fréquence de revue, taux de traitement des écarts",
        quickWin: "Nommer un propriétaire, définir une cible et installer un point de revue court sur le sujet dominant.",
        dueDate: DEFAULT_DUE_DATE,
        potentialGainPrefix: DEFAULT_POTENTIAL_GAIN,
        gainHypotheses: [
          "Le gain devra être précisé à partir de la conséquence dominante identifiée.",
        ],
      };
  }
}

function buildFallbackIndicator(frozen: FrozenDimensionDiagnosis): string {
  return objectiveStrategy(frozen).indicator;
}

function buildFallbackQuickWin(frozen: FrozenDimensionDiagnosis): string {
  return objectiveStrategy(frozen).quickWin;
}

function buildFallbackPotentialGain(frozen: FrozenDimensionDiagnosis): string {
  const mainConsequence = dominantZone(frozen)?.consequence;
  const strategy = objectiveStrategy(frozen);
  if (mainConsequence && normalizeText(mainConsequence)) {
    return `${strategy.potentialGainPrefix} Conséquence prioritaire à réduire : ${truncate(mainConsequence, 150)}`;
  }
  return strategy.potentialGainPrefix || DEFAULT_POTENTIAL_GAIN;
}

function seedAnchoringScore(seed: ObjectiveSeed, frozen: FrozenDimensionDiagnosis): number {
  let score = Number(seed.priorityScore ?? 0);
  const label = normalizeForMatch(seed.label);
  const zoneLabel = normalizeForMatch(dominantZoneLabel(frozen));
  if (zoneLabel && label.includes(zoneLabel)) score += 60;
  if (normalizeText(seed.indicator)) score += 8;
  if (normalizeText(seed.quickWin)) score += 5;
  return score;
}

function rankSeeds(frozen: FrozenDimensionDiagnosis): ObjectiveSeed[] {
  return [...(frozen.objectiveSeeds ?? [])].sort(
    (a, b) => seedAnchoringScore(b, frozen) - seedAnchoringScore(a, frozen)
  );
}

function selectPrimarySeed(frozen: FrozenDimensionDiagnosis): ObjectiveSeed | null {
  return rankSeeds(frozen)[0] ?? null;
}

function seedLabelLooksTooGeneric(label: string): boolean {
  const normalized = normalizeForMatch(label);
  return [
    "reduire lexposition",
    "rendre pilotable",
    "structurer et securiser",
    "axe propose",
    "sous 6 mois",
  ].some((pattern) => normalized.includes(pattern));
}

function buildStrategyLabel(frozen: FrozenDimensionDiagnosis, fallbackLabel?: string | null): string {
  const zoneLabel = normalizeText(fallbackLabel) || dominantZoneLabel(frozen);
  switch (objectiveStrategy(frozen).id) {
    case "arbitration":
      return `Sous 6 mois, clarifier et fiabiliser les arbitrages sur "${zoneLabel}" pour fluidifier la décision au bon niveau`;
    case "dependency":
      return `Sous 6 mois, sécuriser "${zoneLabel}" en réduisant la dépendance à des personnes ou relais clés`;
    case "pricing":
      return `Sous 6 mois, fiabiliser la construction du prix et la tenue de marge sur "${zoneLabel}"`;
    case "cash":
      return `Sous 6 mois, remettre sous pilotage la conversion cash sur "${zoneLabel}"`;
    case "commercial":
      return `Sous 6 mois, rendre pilotable "${zoneLabel}" en structurant le pipeline, la sélectivité et la transformation rentable`;
    case "roles":
      return `Sous 6 mois, clarifier les rôles et responsabilités sur "${zoneLabel}" pour sécuriser l’exécution`;
    case "formalization":
      return `Sous 6 mois, formaliser les règles, rituels et indicateurs sur "${zoneLabel}" pour sortir du pilotage implicite`;
    case "execution":
      return `Sous 6 mois, reprendre le pilotage opérationnel de "${zoneLabel}" pour sécuriser la tenue des engagements`;
    case "generic":
    default:
      return `Sous 6 mois, réduire l’exposition de la dimension "${dimensionTitle(
        frozen.dimensionId
      )}" à la zone non pilotée dominante`;
  }
}

function resolveSeedLabel(seed: ObjectiveSeed | null, frozen: FrozenDimensionDiagnosis): string {
  const label = normalizeText(seed?.label ?? "");
  const zoneLabel = normalizeForMatch(dominantZoneLabel(frozen));
  const grounded = label && zoneLabel && normalizeForMatch(label).includes(zoneLabel);
  if (label && grounded && !seedLabelLooksTooGeneric(label)) {
    return truncate(label, 180);
  }
  return truncate(buildStrategyLabel(frozen, label || null), 180);
}

function indicatorLooksTooGeneric(value: string): boolean {
  const normalized = normalizeForMatch(value);
  return normalized.includes("indicateur de maitrise du theme") || normalized.includes("frequence de revue") || normalized.includes("taux de traitement des ecarts");
}

function resolveSeedIndicator(seed: ObjectiveSeed | null, frozen: FrozenDimensionDiagnosis): string {
  const indicator = normalizeText(seed?.indicator ?? "");
  if (indicator && !indicatorLooksTooGeneric(indicator)) return truncate(indicator, 180);
  return truncate(buildFallbackIndicator(frozen), 180);
}

function resolveSeedDueDate(seed: ObjectiveSeed | null, frozen: FrozenDimensionDiagnosis): string {
  const dueDate = normalizeText(seed?.suggestedDueDate ?? "");
  if (dueDate) return dueDate;
  return objectiveStrategy(frozen).dueDate || DEFAULT_DUE_DATE;
}

function resolveSeedPotentialGain(seed: ObjectiveSeed | null, frozen: FrozenDimensionDiagnosis): string {
  const gain = normalizeText(seed?.potentialGain ?? "");
  if (gain) return truncate(gain, 180);
  return truncate(buildFallbackPotentialGain(frozen), 180);
}

function quickWinLooksTooGeneric(value: string): boolean {
  const normalized = normalizeForMatch(value);
  return normalized.includes("nommer un proprietaire") && normalized.includes("point de revue");
}

function resolveSeedQuickWin(seed: ObjectiveSeed | null, frozen: FrozenDimensionDiagnosis): string {
  const quickWin = normalizeText(seed?.quickWin ?? "");
  if (quickWin && !quickWinLooksTooGeneric(quickWin)) return truncate(quickWin, 180);
  return truncate(buildFallbackQuickWin(frozen), 180);
}

function buildGainHypotheses(frozen: FrozenDimensionDiagnosis): string[] {
  const rootCause = normalizeText(frozen.dominantRootCause);
  const consequence = normalizeText(dominantZone(frozen)?.consequence ?? "");
  const zone = normalizeText(dominantZone(frozen)?.constat ?? "");
  const evidence = normalizeEvidenceSummary(frozen.evidenceSummary);
  const strategy = objectiveStrategy(frozen);

  const hypotheses = uniqueStrings([
    "Aucun chiffre précis n’est inventé.",
    ...strategy.gainHypotheses,
    zone ? `Le gain devra d’abord être relié à la zone non pilotée dominante : ${truncate(zone, 160)}` : "",
    consequence ? `La fourchette devra être reliée à la conséquence économique probable identifiée : ${truncate(consequence, 160)}` : "",
    rootCause ? `Le gain dépendra de la réduction de la cause dominante : ${truncate(rootCause, 160)}` : "",
    evidence ? `Le gain devra être estimé en cohérence avec la synthèse de dimension : ${truncate(evidence, 160)}` : "",
  ]);

  return hypotheses.length > 0 ? hypotheses : ["Aucun chiffre précis n’est inventé."];
}

function nextRevision(objective: FinalObjective): number {
  const current = Number(objective.proposalRevision ?? 1);
  if (!Number.isFinite(current) || current < 1) return 2;
  return current + 1;
}

function appendDecisionHistory(params: {
  objective: FinalObjective;
  status: ObjectiveDecisionStatus;
  nextLabel: string;
  nextSourceSeedId?: string | null;
}): FinalObjectiveDecisionTrace[] {
  const existing = Array.isArray(params.objective.decisionHistory)
    ? params.objective.decisionHistory
    : [];

  return [
    ...existing,
    {
      at: new Date().toISOString(),
      status: params.status,
      previousLabel: params.objective.objectiveLabel,
      nextLabel: params.nextLabel,
      previousSourceSeedId: params.objective.sourceSeedId ?? null,
      nextSourceSeedId: params.nextSourceSeedId ?? null,
    },
  ];
}

function findFrozenDimension(
  frozenDimensions: FrozenDimensionDiagnosis[],
  dimensionId: number
): FrozenDimensionDiagnosis | null {
  return frozenDimensions.find((item) => Number(item.dimensionId) === Number(dimensionId)) ?? null;
}

function buildInitialObjectiveFromSeed(
  frozen: FrozenDimensionDiagnosis,
  index: number,
  seed: ObjectiveSeed | null
): FinalObjective {
  return {
    id: `obj-d${frozen.dimensionId}-${index}`,
    dimensionId: frozen.dimensionId,
    objectiveLabel: resolveSeedLabel(seed, frozen),
    owner: DEFAULT_OBJECTIVE_OWNER,
    keyIndicator: resolveSeedIndicator(seed, frozen),
    dueDate: resolveSeedDueDate(seed, frozen),
    potentialGain: resolveSeedPotentialGain(seed, frozen),
    gainHypotheses: buildGainHypotheses(frozen),
    validationStatus: "proposed",
    quickWin: resolveSeedQuickWin(seed, frozen),
    proposalRevision: 1,
    sourceSeedId: seed?.id ?? null,
    proposalSource: seed ? "initial_seed" : "fallback",
    decisionHistory: [],
  };
}

function collectUsedSeedIds(objective: FinalObjective): Set<string> {
  const out = new Set<string>();
  if (objective.sourceSeedId) out.add(objective.sourceSeedId);
  for (const trace of objective.decisionHistory ?? []) {
    if (trace.previousSourceSeedId) out.add(trace.previousSourceSeedId);
    if (trace.nextSourceSeedId) out.add(trace.nextSourceSeedId);
  }
  return out;
}

function collectUsedLabels(objective: FinalObjective): Set<string> {
  const out = new Set<string>();
  out.add(normalizeForMatch(objective.objectiveLabel));
  for (const trace of objective.decisionHistory ?? []) {
    out.add(normalizeForMatch(trace.previousLabel));
    out.add(normalizeForMatch(trace.nextLabel));
  }
  return out;
}

function selectAlternativeSeed(
  frozen: FrozenDimensionDiagnosis,
  objective: FinalObjective
): ObjectiveSeed | null {
  const ranked = rankSeeds(frozen);
  if (ranked.length === 0) return null;

  const usedSeedIds = collectUsedSeedIds(objective);
  const usedLabels = collectUsedLabels(objective);

  const firstUnusedById = ranked.find((seed) => seed.id && !usedSeedIds.has(seed.id));
  if (firstUnusedById) return firstUnusedById;
  return ranked.find((seed) => !usedLabels.has(normalizeForMatch(seed.label))) ?? null;
}

function buildAlternativeFallbackFromFrozen(
  objective: FinalObjective,
  frozen: FrozenDimensionDiagnosis,
  reason: "refused" | "adjusted"
): FinalObjective {
  const focus = reason === "refused" ? secondaryZoneLabel(frozen) : dominantZoneLabel(frozen);
  const nextLabel =
    reason === "refused"
      ? buildStrategyLabel(frozen, focus)
      : `Sous 6 mois, ajuster l’objectif sur "${focus}" en installant un pilotage plus progressif, mesurable et tenu dans le temps`;

  return {
    ...objective,
    objectiveLabel: truncate(nextLabel, 180),
    keyIndicator: truncate(buildFallbackIndicator(frozen), 180),
    dueDate: resolveSeedDueDate(null, frozen),
    potentialGain: truncate(buildFallbackPotentialGain(frozen), 180),
    quickWin: truncate(buildFallbackQuickWin(frozen), 180),
    gainHypotheses: buildGainHypotheses(frozen),
    validationStatus: "proposed",
    proposalRevision: nextRevision(objective),
    sourceSeedId: null,
    proposalSource: "fallback",
    decisionHistory: appendDecisionHistory({
      objective,
      status: reason,
      nextLabel,
      nextSourceSeedId: null,
    }),
  };
}

function buildAlternativeProposalFromSeed(
  objective: FinalObjective,
  frozen: FrozenDimensionDiagnosis,
  seed: ObjectiveSeed
): FinalObjective {
  const nextLabel = resolveSeedLabel(seed, frozen);

  return {
    ...objective,
    objectiveLabel: nextLabel,
    keyIndicator: resolveSeedIndicator(seed, frozen),
    dueDate: resolveSeedDueDate(seed, frozen),
    potentialGain: resolveSeedPotentialGain(seed, frozen),
    quickWin: resolveSeedQuickWin(seed, frozen),
    gainHypotheses: buildGainHypotheses(frozen),
    validationStatus: "proposed",
    proposalRevision: nextRevision(objective),
    sourceSeedId: seed.id ?? null,
    proposalSource: "alternative_seed",
    decisionHistory: appendDecisionHistory({
      objective,
      status: "refused",
      nextLabel,
      nextSourceSeedId: seed.id ?? null,
    }),
  };
}

function buildAdjustedProposal(
  objective: FinalObjective,
  frozen: FrozenDimensionDiagnosis,
  decision: ObjectiveDecisionInput
): FinalObjective {
  const hasExplicitFeedback =
    normalizeText(decision.adjustedLabel) ||
    normalizeText(decision.adjustedIndicator) ||
    normalizeText(decision.adjustedDueDate) ||
    normalizeText(decision.adjustedPotentialGain) ||
    normalizeText(decision.adjustedQuickWin);

  const nextLabel =
    normalizeText(decision.adjustedLabel) ||
    buildStrategyLabel(frozen, dominantZoneLabel(frozen));

  return {
    ...objective,
    objectiveLabel: truncate(nextLabel, 180),
    keyIndicator: truncate(normalizeText(decision.adjustedIndicator) || objective.keyIndicator || buildFallbackIndicator(frozen), 180),
    dueDate: normalizeText(decision.adjustedDueDate) || objective.dueDate || resolveSeedDueDate(null, frozen),
    potentialGain: truncate(normalizeText(decision.adjustedPotentialGain) || objective.potentialGain || buildFallbackPotentialGain(frozen), 180),
    quickWin: truncate(normalizeText(decision.adjustedQuickWin) || objective.quickWin || buildFallbackQuickWin(frozen), 180),
    gainHypotheses: buildGainHypotheses(frozen),
    validationStatus: "proposed",
    proposalRevision: nextRevision(objective),
    proposalSource: hasExplicitFeedback ? "adjusted_feedback" : "fallback",
    decisionHistory: appendDecisionHistory({
      objective,
      status: "adjusted",
      nextLabel,
      nextSourceSeedId: objective.sourceSeedId ?? null,
    }),
  };
}

export function buildObjectiveFromFrozenDimension(
  frozen: FrozenDimensionDiagnosis,
  index: number
): FinalObjective {
  const seed = selectPrimarySeed(frozen);
  return buildInitialObjectiveFromSeed(frozen, index, seed);
}

export function buildFinalObjectiveSetFromFrozenDimensions(
  frozenDimensions: FrozenDimensionDiagnosis[]
): FinalObjectiveSet {
  const objectives = uniqueById(
    [...frozenDimensions]
      .sort((a, b) => a.dimensionId - b.dimensionId)
      .map((frozen, index) => buildObjectiveFromFrozenDimension(frozen, index + 1))
  );

  return {
    header: FINAL_OBJECTIVES_HEADER,
    objectives,
  };
}

export function applyObjectiveDecisions(params: {
  objectives: FinalObjective[];
  decisions: ObjectiveDecisionInput[];
  frozenDimensions?: FrozenDimensionDiagnosis[];
}): FinalObjective[] {
  const decisionsById = new Map(params.decisions.map((decision) => [decision.objectiveId, decision]));

  return params.objectives.map((objective) => {
    const decision = decisionsById.get(objective.id);
    if (!decision) return objective;

    const frozen = findFrozenDimension(params.frozenDimensions ?? [], Number(objective.dimensionId));

    if (decision.status === "validated") {
      return {
        ...objective,
        validationStatus: "validated",
        decisionHistory: appendDecisionHistory({
          objective,
          status: "validated",
          nextLabel: objective.objectiveLabel,
          nextSourceSeedId: objective.sourceSeedId ?? null,
        }),
      };
    }

    if (!frozen) {
      return {
        ...objective,
        validationStatus: "proposed",
      };
    }

    if (decision.status === "adjusted") {
      return buildAdjustedProposal(objective, frozen, decision);
    }

    const alternativeSeed = selectAlternativeSeed(frozen, objective);
    if (alternativeSeed) {
      return buildAlternativeProposalFromSeed(objective, frozen, alternativeSeed);
    }

    return buildAlternativeFallbackFromFrozen(objective, frozen, "refused");
  });
}
