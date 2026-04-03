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

function dominantZoneLabel(frozen: FrozenDimensionDiagnosis): string {
  const zone = dominantZone(frozen);
  if (!zone) return "zone non pilotée dominante";
  const theme = extractThemeFromText(zone.constat);
  if (theme) return theme;
  return truncate(firstSentence(zone.constat), 110);
}

function secondaryZoneLabel(frozen: FrozenDimensionDiagnosis): string {
  const zone = secondaryZone(frozen);
  if (!zone) return dominantZoneLabel(frozen);
  const theme = extractThemeFromText(zone.constat);
  if (theme) return theme;
  return truncate(firstSentence(zone.constat), 110);
}

function buildFallbackIndicator(frozen: FrozenDimensionDiagnosis): string {
  const text = normalizeText(
    [
      frozen.dominantRootCause,
      ...(frozen.unmanagedZones ?? []).map((zone) => zone.constat),
      ...(frozen.consolidatedFindings ?? []),
    ].join(" ")
  ).toLowerCase();

  if (text.includes("commercial") || text.includes("marché") || text.includes("pipeline")) {
    return "Taux de transformation, volume d’opportunités actives, marge des affaires signées";
  }
  if (text.includes("prix") || text.includes("marge") || text.includes("devis")) {
    return "Écart prix vendu / coût réel, marge à affaire, taux de dérive devis";
  }
  if (text.includes("cash") || text.includes("trésorerie") || text.includes("facturation")) {
    return "Prévision de cash, encours, délai de facturation et de recouvrement";
  }
  if (text.includes("rh") || text.includes("organisation") || text.includes("équipe")) {
    return "Couverture des rôles clés, stabilité des équipes, niveau de dépendance sur personnes clés";
  }
  return "Indicateur de maîtrise du thème, fréquence de revue, taux de traitement des écarts";
}

function buildFallbackQuickWin(frozen: FrozenDimensionDiagnosis): string {
  const zone = dominantZone(frozen);
  if (zone) {
    return `Dans les 30 jours, nommer un propriétaire et installer un point de revue sur : ${truncate(firstSentence(zone.constat), 150)}`;
  }
  return "Clarifier un premier point de pilotage concret et visible dans le mois.";
}

function buildFallbackPotentialGain(frozen: FrozenDimensionDiagnosis): string {
  const mainConsequence = dominantZone(frozen)?.consequence;
  if (mainConsequence && normalizeText(mainConsequence)) {
    return `Gain à préciser en validation finale, en lien avec la conséquence prioritaire identifiée : ${truncate(mainConsequence, 150)}`;
  }
  return DEFAULT_POTENTIAL_GAIN;
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

function resolveSeedLabel(seed: ObjectiveSeed | null, frozen: FrozenDimensionDiagnosis): string {
  const label = normalizeText(seed?.label ?? "");
  if (label) return truncate(label, 180);
  return `Sous 6 mois, réduire l’exposition de la dimension "${dimensionTitle(
    frozen.dimensionId
  )}" à la zone non pilotée dominante`;
}

function resolveSeedIndicator(seed: ObjectiveSeed | null, frozen: FrozenDimensionDiagnosis): string {
  const indicator = normalizeText(seed?.indicator ?? "");
  if (indicator) return truncate(indicator, 180);
  return buildFallbackIndicator(frozen);
}

function resolveSeedDueDate(seed: ObjectiveSeed | null): string {
  const dueDate = normalizeText(seed?.suggestedDueDate ?? "");
  return dueDate || DEFAULT_DUE_DATE;
}

function resolveSeedPotentialGain(seed: ObjectiveSeed | null, frozen: FrozenDimensionDiagnosis): string {
  const gain = normalizeText(seed?.potentialGain ?? "");
  if (gain) return truncate(gain, 180);
  return buildFallbackPotentialGain(frozen);
}

function resolveSeedQuickWin(seed: ObjectiveSeed | null, frozen: FrozenDimensionDiagnosis): string {
  const quickWin = normalizeText(seed?.quickWin ?? "");
  if (quickWin) return truncate(quickWin, 180);
  return buildFallbackQuickWin(frozen);
}

function buildGainHypotheses(frozen: FrozenDimensionDiagnosis): string[] {
  const rootCause = normalizeText(frozen.dominantRootCause);
  const consequence = normalizeText(dominantZone(frozen)?.consequence ?? "");
  const zone = normalizeText(dominantZone(frozen)?.constat ?? "");
  const evidence = normalizeEvidenceSummary(frozen.evidenceSummary);

  const hypotheses = uniqueStrings([
    "Aucun chiffre précis n’est inventé.",
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
    dueDate: resolveSeedDueDate(seed),
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
      ? `Sous 6 mois, sécuriser prioritairement "${focus}" en réduisant le risque managérial dominant sans élargir le périmètre trop vite`
      : `Sous 6 mois, ajuster l’objectif sur "${focus}" en installant un cadre de pilotage plus progressif, mesurable et tenu dans le temps`;

  return {
    ...objective,
    objectiveLabel: truncate(nextLabel, 180),
    keyIndicator: buildFallbackIndicator(frozen),
    dueDate: DEFAULT_DUE_DATE,
    potentialGain: buildFallbackPotentialGain(frozen),
    quickWin: buildFallbackQuickWin(frozen),
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
    dueDate: resolveSeedDueDate(seed),
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
    `Sous 6 mois, ajuster et rendre pilotable "${dominantZoneLabel(frozen)}" avec un cadre de revue plus simple, plus concret et plus mesurable`;

  return {
    ...objective,
    objectiveLabel: truncate(nextLabel, 180),
    keyIndicator: truncate(normalizeText(decision.adjustedIndicator) || objective.keyIndicator || buildFallbackIndicator(frozen), 180),
    dueDate: normalizeText(decision.adjustedDueDate) || objective.dueDate || DEFAULT_DUE_DATE,
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
