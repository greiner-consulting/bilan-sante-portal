// lib/bilan-sante/objectives-builder.ts

import type {
  FinalObjective,
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
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function normalizeEvidenceSummary(value: unknown): string {
  if (Array.isArray(value)) {
    return normalizeText(value.join(" "));
  }

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

function dominantZoneLabel(frozen: FrozenDimensionDiagnosis): string {
  const zone = dominantZone(frozen);
  if (!zone) return "zone non pilotée dominante";

  const theme = extractThemeFromText(zone.constat);
  if (theme) return theme;

  return truncate(
    firstSentence(zone.constat)
      .replace(/^le\s+th[èe]me\s+/i, "")
      .replace(/^sur\s+le\s+th[èe]me\s+/i, "")
      .replace(/^la\s+zone\s+/i, "")
      .trim(),
    110
  );
}

function zoneAnchorText(frozen: FrozenDimensionDiagnosis): string {
  const zone = dominantZone(frozen);
  if (!zone) return "";
  return truncate(firstSentence(zone.constat), 150);
}

function buildFallbackIndicator(frozen: FrozenDimensionDiagnosis): string {
  const text = normalizeText(
    [
      frozen.dominantRootCause,
      ...(frozen.unmanagedZones ?? []).map((zone) => zone.constat),
      ...(frozen.consolidatedFindings ?? []),
    ].join(" ")
  ).toLowerCase();

  if (
    text.includes("commercial") ||
    text.includes("marché") ||
    text.includes("marche") ||
    text.includes("pipeline") ||
    text.includes("opportunité") ||
    text.includes("opportunite")
  ) {
    return "Taux de transformation, volume d’opportunités actives, marge des affaires signées";
  }

  if (
    text.includes("prix") ||
    text.includes("marge") ||
    text.includes("devis") ||
    text.includes("rentabilité") ||
    text.includes("rentabilite")
  ) {
    return "Écart prix vendu / coût réel, marge à affaire, taux de dérive devis";
  }

  if (
    text.includes("cash") ||
    text.includes("trésorerie") ||
    text.includes("tresorerie") ||
    text.includes("facturation") ||
    text.includes("recouvrement")
  ) {
    return "Prévision de cash, encours, délai de facturation et de recouvrement";
  }

  if (
    text.includes("rh") ||
    text.includes("organisation") ||
    text.includes("équipe") ||
    text.includes("equipe") ||
    text.includes("responsabilité") ||
    text.includes("responsabilite")
  ) {
    return "Couverture des rôles clés, stabilité des équipes, niveau de dépendance sur personnes clés";
  }

  return "Indicateur de maîtrise du thème, fréquence de revue, taux de traitement des écarts";
}

function buildFallbackQuickWin(frozen: FrozenDimensionDiagnosis): string {
  const zone = dominantZone(frozen);

  if (zone) {
    return `Dans les 30 jours, nommer un propriétaire et installer un point de revue sur : ${truncate(firstSentence(zone.constat), 150)}`;
  }

  const mainFinding = frozen.consolidatedFindings?.[0];
  if (mainFinding && normalizeText(mainFinding)) {
    return `Sécuriser en premier le point : ${truncate(mainFinding, 150)}`;
  }

  return "Clarifier un premier point de pilotage concret et visible dans le mois.";
}

function buildFallbackPotentialGain(frozen: FrozenDimensionDiagnosis): string {
  const mainConsequence = dominantZone(frozen)?.consequence;

  if (mainConsequence && normalizeText(mainConsequence)) {
    return `Gain à préciser en validation finale, en lien avec la conséquence prioritaire identifiée : ${truncate(
      mainConsequence,
      150
    )}`;
  }

  return DEFAULT_POTENTIAL_GAIN;
}

function seedAnchoringScore(seed: ObjectiveSeed, frozen: FrozenDimensionDiagnosis): number {
  let score = Number(seed.priorityScore ?? 0);
  const label = normalizeForMatch(seed.label);
  const zoneText = normalizeForMatch(zoneAnchorText(frozen));
  const zoneLabel = normalizeForMatch(dominantZoneLabel(frozen));

  if (zoneLabel && label.includes(zoneLabel)) score += 60;
  if (zoneText && label && (zoneText.includes(label) || label.includes(zoneText.slice(0, Math.min(zoneText.length, 36))))) {
    score += 25;
  }

  if (normalizeText(seed.indicator)) score += 8;
  if (normalizeText(seed.quickWin)) score += 5;

  return score;
}

function selectPrimarySeed(frozen: FrozenDimensionDiagnosis): ObjectiveSeed | null {
  const seeds = frozen.objectiveSeeds ?? [];
  if (seeds.length === 0) return null;

  const sorted = [...seeds].sort((a, b) => seedAnchoringScore(b, frozen) - seedAnchoringScore(a, frozen));
  return sorted[0] ?? null;
}

function buildObjectiveLabel(frozen: FrozenDimensionDiagnosis): string {
  const zone = dominantZone(frozen);
  const seed = selectPrimarySeed(frozen);
  const label = normalizeText(seed?.label ?? "");

  if (label) {
    return truncate(label, 180);
  }

  if (zone) {
    return truncate(
      `Sous 6 mois, rendre pilotable la zone dominante "${dominantZoneLabel(frozen)}" en traitant le point suivant : ${firstSentence(zone.constat)}`,
      180
    );
  }

  return `Réduire sous 6 mois l’exposition de la dimension "${dimensionTitle(
    frozen.dimensionId
  )}" à la zone non pilotée dominante`;
}

function buildObjectiveIndicator(frozen: FrozenDimensionDiagnosis): string {
  const seed = selectPrimarySeed(frozen);
  const indicator = normalizeText(seed?.indicator ?? "");

  if (indicator) {
    return truncate(indicator, 180);
  }

  return buildFallbackIndicator(frozen);
}

function buildObjectiveDueDate(frozen: FrozenDimensionDiagnosis): string {
  const seed = selectPrimarySeed(frozen);
  const suggestedDueDate = normalizeText(seed?.suggestedDueDate ?? "");

  if (suggestedDueDate) {
    return suggestedDueDate;
  }

  return DEFAULT_DUE_DATE;
}

function buildObjectivePotentialGain(frozen: FrozenDimensionDiagnosis): string {
  const seed = selectPrimarySeed(frozen);
  const potentialGain = normalizeText(seed?.potentialGain ?? "");

  if (potentialGain) {
    return truncate(potentialGain, 180);
  }

  return buildFallbackPotentialGain(frozen);
}

function buildObjectiveQuickWin(frozen: FrozenDimensionDiagnosis): string {
  const seed = selectPrimarySeed(frozen);
  const quickWin = normalizeText(seed?.quickWin ?? "");

  if (quickWin) {
    return truncate(quickWin, 180);
  }

  return buildFallbackQuickWin(frozen);
}

function buildGainHypotheses(frozen: FrozenDimensionDiagnosis): string[] {
  const rootCause = normalizeText(frozen.dominantRootCause);
  const consequence = normalizeText(dominantZone(frozen)?.consequence ?? "");
  const zone = normalizeText(dominantZone(frozen)?.constat ?? "");
  const evidence = normalizeEvidenceSummary(frozen.evidenceSummary);

  const hypotheses = uniqueStrings([
    "Aucun chiffre précis n’est inventé.",
    zone
      ? `Le gain devra d’abord être relié à la zone non pilotée dominante : ${truncate(zone, 160)}`
      : "",
    consequence
      ? `La fourchette devra être reliée à la conséquence économique probable identifiée : ${truncate(
          consequence,
          160
        )}`
      : "La fourchette devra être reliée à la conséquence économique probable identifiée.",
    rootCause
      ? `Le gain dépendra de la réduction de la cause dominante : ${truncate(rootCause, 160)}`
      : "",
    evidence
      ? `Le gain devra être estimé en cohérence avec la synthèse de dimension : ${truncate(
          evidence,
          160
        )}`
      : "",
  ]);

  return hypotheses.length > 0 ? hypotheses : ["Aucun chiffre précis n’est inventé."];
}

export function buildObjectiveFromFrozenDimension(
  frozen: FrozenDimensionDiagnosis,
  index: number
): FinalObjective {
  return {
    id: `obj-d${frozen.dimensionId}-${index}`,
    dimensionId: frozen.dimensionId,
    objectiveLabel: buildObjectiveLabel(frozen),
    owner: DEFAULT_OBJECTIVE_OWNER,
    keyIndicator: buildObjectiveIndicator(frozen),
    dueDate: buildObjectiveDueDate(frozen),
    potentialGain: buildObjectivePotentialGain(frozen),
    gainHypotheses: buildGainHypotheses(frozen),
    validationStatus: "proposed",
    quickWin: buildObjectiveQuickWin(frozen),
  };
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
}): FinalObjective[] {
  const decisionsById = new Map(
    params.decisions.map((decision) => [decision.objectiveId, decision])
  );

  return params.objectives.map((objective) => {
    const decision = decisionsById.get(objective.id);
    if (!decision) return objective;

    const nextLabel =
      decision.status === "adjusted" && normalizeText(decision.adjustedLabel)
        ? normalizeText(decision.adjustedLabel)
        : objective.objectiveLabel;

    const nextIndicator =
      decision.status === "adjusted" && normalizeText(decision.adjustedIndicator)
        ? normalizeText(decision.adjustedIndicator)
        : objective.keyIndicator;

    const nextDueDate =
      decision.status === "adjusted" && normalizeText(decision.adjustedDueDate)
        ? normalizeText(decision.adjustedDueDate)
        : objective.dueDate;

    const nextPotentialGain =
      decision.status === "adjusted" && normalizeText(decision.adjustedPotentialGain)
        ? normalizeText(decision.adjustedPotentialGain)
        : objective.potentialGain;

    const nextQuickWin =
      decision.status === "adjusted" && normalizeText(decision.adjustedQuickWin)
        ? normalizeText(decision.adjustedQuickWin)
        : objective.quickWin;

    return {
      ...objective,
      objectiveLabel: nextLabel,
      keyIndicator: nextIndicator,
      dueDate: nextDueDate,
      potentialGain: nextPotentialGain,
      quickWin: nextQuickWin,
      validationStatus: decision.status,
    };
  });
}
