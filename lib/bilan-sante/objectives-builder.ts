// lib/bilan-sante/objectives-builder.ts

import type {
  FinalObjective,
  FinalObjectiveSet,
  FrozenDimensionDiagnosis,
  ObjectiveSeed,
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
  return [...new Set(items.map((item) => normalizeText(item)).filter(Boolean))];
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
  const mainZone = frozen.unmanagedZones?.[0]?.constat;
  const mainFinding = frozen.consolidatedFindings?.[0];

  if (mainZone && normalizeText(mainZone)) {
    return `Sécuriser en premier le point : ${truncate(mainZone, 150)}`;
  }

  if (mainFinding && normalizeText(mainFinding)) {
    return `Sécuriser en premier le point : ${truncate(mainFinding, 150)}`;
  }

  return "Clarifier un premier point de pilotage concret et visible dans le mois.";
}

function buildFallbackPotentialGain(frozen: FrozenDimensionDiagnosis): string {
  const mainConsequence = frozen.unmanagedZones?.[0]?.consequence;

  if (mainConsequence && normalizeText(mainConsequence)) {
    return `Gain à préciser en validation finale, en lien avec la conséquence prioritaire identifiée : ${truncate(
      mainConsequence,
      150
    )}`;
  }

  return DEFAULT_POTENTIAL_GAIN;
}

function selectPrimarySeed(frozen: FrozenDimensionDiagnosis): ObjectiveSeed | null {
  const seeds = frozen.objectiveSeeds ?? [];
  if (seeds.length === 0) return null;

  const sorted = [...seeds].sort(
    (a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0)
  );

  return sorted[0] ?? null;
}

function buildObjectiveLabel(frozen: FrozenDimensionDiagnosis): string {
  const seed = selectPrimarySeed(frozen);
  const label = seed?.label ?? "";

  if (normalizeText(label)) {
    return truncate(label, 180);
  }

  return `Réduire sous 6 mois l’exposition de la dimension "${dimensionTitle(
    frozen.dimensionId
  )}" à la zone non pilotée dominante`;
}

function buildObjectiveIndicator(frozen: FrozenDimensionDiagnosis): string {
  const seed = selectPrimarySeed(frozen);
  const indicator = seed?.indicator ?? "";

  if (normalizeText(indicator)) {
    return truncate(indicator, 180);
  }

  return buildFallbackIndicator(frozen);
}

function buildObjectiveDueDate(frozen: FrozenDimensionDiagnosis): string {
  const seed = selectPrimarySeed(frozen);
  const suggestedDueDate = seed?.suggestedDueDate ?? "";

  if (normalizeText(suggestedDueDate)) {
    return suggestedDueDate;
  }

  return DEFAULT_DUE_DATE;
}

function buildObjectivePotentialGain(frozen: FrozenDimensionDiagnosis): string {
  const seed = selectPrimarySeed(frozen);
  const potentialGain = seed?.potentialGain ?? "";

  if (normalizeText(potentialGain)) {
    return truncate(potentialGain, 180);
  }

  return buildFallbackPotentialGain(frozen);
}

function buildObjectiveQuickWin(frozen: FrozenDimensionDiagnosis): string {
  const seed = selectPrimarySeed(frozen);
  const quickWin = seed?.quickWin ?? "";

  if (normalizeText(quickWin)) {
    return truncate(quickWin, 180);
  }

  return buildFallbackQuickWin(frozen);
}

function buildGainHypotheses(frozen: FrozenDimensionDiagnosis): string[] {
  const rootCause = normalizeText(frozen.dominantRootCause);
  const consequence = normalizeText(frozen.unmanagedZones?.[0]?.consequence ?? "");
  const evidence = normalizeEvidenceSummary(frozen.evidenceSummary);

  const hypotheses = uniqueStrings([
    "Aucun chiffre précis n’est inventé.",
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