import type {
  DimensionId,
  FrozenDimensionSnapshot,
} from "@/lib/bilan-sante/session-model";

export type ObjectiveDecisionStatus = "validated" | "adjusted" | "refused";

export interface FinalObjectiveDecisionTrace {
  at: string;
  status: ObjectiveDecisionStatus;
  previousLabel: string;
  nextLabel: string;
}

export interface FinalObjective {
  id: string;
  dimensionId: DimensionId;
  objectiveLabel: string;
  owner: string;
  keyIndicator: string;
  dueDate: string;
  potentialGain: string;
  gainHypotheses: string[];
  validationStatus: "proposed" | "validated";
  quickWin: string;
  proposalRevision: number;
  decisionHistory: FinalObjectiveDecisionTrace[];
}

export interface FinalObjectiveSet {
  header: string;
  objectives: FinalObjective[];
}

export type ObjectiveDecisionInput = {
  objectiveId: string;
  status: ObjectiveDecisionStatus;
  adjustedLabel?: string;
  adjustedIndicator?: string;
  adjustedDueDate?: string;
  adjustedPotentialGain?: string;
  adjustedQuickWin?: string;
};

const FINAL_OBJECTIVES_HEADER = "Objectifs finaux proposés";
const DEFAULT_OBJECTIVE_OWNER = "Dirigeant / responsable de dimension";
const DEFAULT_DUE_DATE = "À définir avec le dirigeant";
const DEFAULT_POTENTIAL_GAIN =
  "Fourchette prudente à estimer lors de la validation finale selon les données disponibles.";

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

function dimensionTitle(dimensionId: DimensionId): string {
  switch (dimensionId) {
    case "organisation":
      return "Organisation";
    case "commerce":
      return "Commerce";
    case "production":
      return "Production";
    case "financier":
      return "Financier";
    default:
      return dimensionId;
  }
}

function firstFinding(frozen: FrozenDimensionSnapshot): string {
  return (
    frozen.keyFindings[0] ||
    frozen.nonPilotedAreas[0] ||
    `Point prioritaire à sécuriser sur la dimension "${dimensionTitle(
      frozen.dimensionId
    )}".`
  );
}

function firstNonPilotedArea(frozen: FrozenDimensionSnapshot): string {
  return (
    frozen.nonPilotedAreas[0] ||
    frozen.keyFindings[0] ||
    `Zone de maîtrise à renforcer sur la dimension "${dimensionTitle(
      frozen.dimensionId
    )}".`
  );
}

function buildFallbackIndicator(frozen: FrozenDimensionSnapshot): string {
  const text = normalizeText(
    [...frozen.keyFindings, ...frozen.nonPilotedAreas].join(" ")
  ).toLowerCase();

  if (
    text.includes("commercial") ||
    text.includes("client") ||
    text.includes("pipeline") ||
    text.includes("transformation")
  ) {
    return "Taux de transformation, volume d’opportunités actives, marge des affaires signées";
  }

  if (
    text.includes("prix") ||
    text.includes("devis") ||
    text.includes("marge") ||
    text.includes("chiffrage")
  ) {
    return "Écart prix vendu / coût réel, marge à affaire, taux de dérive devis";
  }

  if (
    text.includes("cash") ||
    text.includes("trésorerie") ||
    text.includes("facturation") ||
    text.includes("encours")
  ) {
    return "Prévision de cash, encours, délai de facturation et de recouvrement";
  }

  if (
    text.includes("organisation") ||
    text.includes("équipe") ||
    text.includes("rôle") ||
    text.includes("responsabilité")
  ) {
    return "Couverture des rôles clés, stabilité des équipes, niveau de dépendance sur personnes clés";
  }

  return "Indicateur de maîtrise du thème, fréquence de revue, taux de traitement des écarts";
}

function buildFallbackQuickWin(frozen: FrozenDimensionSnapshot): string {
  return `Dans les 30 jours, nommer un propriétaire et installer un point de revue sur : ${truncate(
    firstNonPilotedArea(frozen),
    150
  )}`;
}

function buildFallbackPotentialGain(frozen: FrozenDimensionSnapshot): string {
  const focus = firstNonPilotedArea(frozen);
  if (focus) {
    return `Gain à préciser en validation finale, en lien avec le point prioritaire suivant : ${truncate(
      focus,
      150
    )}`;
  }

  return DEFAULT_POTENTIAL_GAIN;
}

function buildGainHypotheses(frozen: FrozenDimensionSnapshot): string[] {
  const hypotheses = [
    "Aucun chiffre précis n’est inventé.",
    `Le gain devra être relié en priorité au point suivant : ${truncate(
      firstNonPilotedArea(frozen),
      160
    )}`,
    `L’évaluation devra rester cohérente avec les constats retenus sur la dimension "${dimensionTitle(
      frozen.dimensionId
    )}".`,
  ];

  return hypotheses.map((item) => normalizeText(item)).filter(Boolean);
}

function appendDecisionHistory(params: {
  objective: FinalObjective;
  status: ObjectiveDecisionStatus;
  nextLabel: string;
}): FinalObjectiveDecisionTrace[] {
  return [
    ...(params.objective.decisionHistory ?? []),
    {
      at: new Date().toISOString(),
      status: params.status,
      previousLabel: params.objective.objectiveLabel,
      nextLabel: params.nextLabel,
    },
  ];
}

function nextRevision(objective: FinalObjective): number {
  const current = Number(objective.proposalRevision ?? 1);
  if (!Number.isFinite(current) || current < 1) return 2;
  return current + 1;
}

function buildObjectiveLabel(frozen: FrozenDimensionSnapshot): string {
  return `Sous 6 mois, sécuriser la dimension "${dimensionTitle(
    frozen.dimensionId
  )}" en réduisant le point de fragilité principal`;
}

function buildObjectiveFromFrozenDimension(
  frozen: FrozenDimensionSnapshot,
  index: number
): FinalObjective {
  return {
    id: `obj-${frozen.dimensionId}-${index}`,
    dimensionId: frozen.dimensionId,
    objectiveLabel: buildObjectiveLabel(frozen),
    owner: DEFAULT_OBJECTIVE_OWNER,
    keyIndicator: buildFallbackIndicator(frozen),
    dueDate: DEFAULT_DUE_DATE,
    potentialGain: buildFallbackPotentialGain(frozen),
    gainHypotheses: buildGainHypotheses(frozen),
    validationStatus: "proposed",
    quickWin: buildFallbackQuickWin(frozen),
    proposalRevision: 1,
    decisionHistory: [],
  };
}

function findFrozenDimension(
  frozenDimensions: FrozenDimensionSnapshot[],
  dimensionId: DimensionId
): FrozenDimensionSnapshot | null {
  return (
    frozenDimensions.find((item) => item.dimensionId === dimensionId) ?? null
  );
}

function buildAdjustedProposal(
  objective: FinalObjective,
  frozen: FrozenDimensionSnapshot,
  decision: ObjectiveDecisionInput
): FinalObjective {
  const nextLabel =
    normalizeText(decision.adjustedLabel) ||
    `Sous 6 mois, ajuster et rendre pilotable la dimension "${dimensionTitle(
      frozen.dimensionId
    )}" avec un cadre plus simple et plus mesurable`;

  return {
    ...objective,
    objectiveLabel: truncate(nextLabel, 180),
    keyIndicator: truncate(
      normalizeText(decision.adjustedIndicator) ||
        objective.keyIndicator ||
        buildFallbackIndicator(frozen),
      180
    ),
    dueDate:
      normalizeText(decision.adjustedDueDate) ||
      objective.dueDate ||
      DEFAULT_DUE_DATE,
    potentialGain: truncate(
      normalizeText(decision.adjustedPotentialGain) ||
        objective.potentialGain ||
        buildFallbackPotentialGain(frozen),
      180
    ),
    quickWin: truncate(
      normalizeText(decision.adjustedQuickWin) ||
        objective.quickWin ||
        buildFallbackQuickWin(frozen),
      180
    ),
    gainHypotheses: buildGainHypotheses(frozen),
    validationStatus: "proposed",
    proposalRevision: nextRevision(objective),
    decisionHistory: appendDecisionHistory({
      objective,
      status: "adjusted",
      nextLabel,
    }),
  };
}

function buildFallbackAlternative(
  objective: FinalObjective,
  frozen: FrozenDimensionSnapshot
): FinalObjective {
  const nextLabel = `Sous 6 mois, reprendre sous un angle plus resserré le traitement prioritaire de la dimension "${dimensionTitle(
    frozen.dimensionId
  )}"`;

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
    decisionHistory: appendDecisionHistory({
      objective,
      status: "refused",
      nextLabel,
    }),
  };
}

export function buildFinalObjectiveSetFromFrozenDimensions(
  frozenDimensions: FrozenDimensionSnapshot[]
): FinalObjectiveSet {
  const objectives = uniqueById(
    [...frozenDimensions].map((frozen, index) =>
      buildObjectiveFromFrozenDimension(frozen, index + 1)
    )
  );

  return {
    header: FINAL_OBJECTIVES_HEADER,
    objectives,
  };
}

export function applyObjectiveDecisions(params: {
  objectives: FinalObjective[];
  decisions: ObjectiveDecisionInput[];
  frozenDimensions?: FrozenDimensionSnapshot[];
}): FinalObjective[] {
  const decisionsById = new Map(
    params.decisions.map((decision) => [decision.objectiveId, decision] as const)
  );

  return params.objectives.map((objective) => {
    const decision = decisionsById.get(objective.id);
    if (!decision) return objective;

    const frozen = findFrozenDimension(
      params.frozenDimensions ?? [],
      objective.dimensionId
    );

    if (decision.status === "validated") {
      return {
        ...objective,
        validationStatus: "validated",
        decisionHistory: appendDecisionHistory({
          objective,
          status: "validated",
          nextLabel: objective.objectiveLabel,
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

    return buildFallbackAlternative(objective, frozen);
  });
}