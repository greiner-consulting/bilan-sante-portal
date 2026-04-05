import type {
  DimensionId,
  IterationCoverage,
  IterationNumber,
} from "./session-model";

export interface IterationRule {
  iteration: IterationNumber;
  targetCount: number;
  minimumCount: number;
}

export interface DimensionDefinition {
  id: DimensionId;
  label: string;
  description: string;
  requiredThemes: string[];
}

export interface DiagnosticProtocol {
  version: string;
  dimensions: DimensionDefinition[];
  nominalIterationRules: IterationRule[];
  weakMatterIterationRules: IterationRule[];
  constraints: {
    iterationsPerDimension: 3;
    forbidUnsupportedQuestion: boolean;
    forbidSemanticDuplicatesWithinIteration: boolean;
    requireSourceTraceability: boolean;
    prioritizeStrongMatterInIteration1: boolean;
    useDriverMemoryForIterations2And3: boolean;
    preservePdfCompatibility: boolean;
  };
}

export const DIAGNOSTIC_DIMENSIONS: DimensionDefinition[] = [
  {
    id: "organisation",
    label: "Organisation",
    description:
      "Organisation, roles, encadrement, coordination, postes cles et capacite de fonctionnement collectif.",
    requiredThemes: [
      "qualite et adequation des equipes",
      "ressources vs charge",
      "recrutement et integration",
      "clarte des roles",
      "stabilite des equipes",
    ],
  },
  {
    id: "commerce",
    label: "Commerce",
    description:
      "Positionnement, deploiement commercial, ciblage, transformation, dependances relationnelles et logique de croissance.",
    requiredThemes: [
      "strategie commerciale",
      "deploiement commercial reel",
      "pipeline et transformation",
      "croissance rentable",
    ],
  },
  {
    id: "production",
    label: "Production",
    description:
      "Execution, adequation des ressources, capacite, productivite, qualite de realisation et anticipation operationnelle.",
    requiredThemes: [
      "construction du prix et hypotheses",
      "delegation et arbitrage",
      "fiabilite du chiffrage",
      "maitrise des ecarts",
    ],
  },
  {
    id: "financier",
    label: "Financier",
    description:
      "Performance economique, rentabilite, structure des marges, tensions de pilotage et soutenabilite.",
    requiredThemes: [
      "indicateurs et rituels manageriaux",
      "pilotage cash resultat marges",
      "productivite et gestion des effectifs",
      "performance economique",
    ],
  },
];

export const NOMINAL_ITERATION_RULES: IterationRule[] = [
  { iteration: 1, targetCount: 5, minimumCount: 5 },
  { iteration: 2, targetCount: 5, minimumCount: 5 },
  { iteration: 3, targetCount: 4, minimumCount: 4 },
];

export const WEAK_MATTER_ITERATION_RULES: IterationRule[] = [
  { iteration: 1, targetCount: 4, minimumCount: 4 },
  { iteration: 2, targetCount: 4, minimumCount: 4 },
  { iteration: 3, targetCount: 3, minimumCount: 3 },
];

export const DIAGNOSTIC_PROTOCOL: DiagnosticProtocol = {
  version: "2.0.0",
  dimensions: DIAGNOSTIC_DIMENSIONS,
  nominalIterationRules: NOMINAL_ITERATION_RULES,
  weakMatterIterationRules: WEAK_MATTER_ITERATION_RULES,
  constraints: {
    iterationsPerDimension: 3,
    forbidUnsupportedQuestion: true,
    forbidSemanticDuplicatesWithinIteration: true,
    requireSourceTraceability: true,
    prioritizeStrongMatterInIteration1: true,
    useDriverMemoryForIterations2And3: true,
    preservePdfCompatibility: true,
  },
};

export function getIterationRule(
  iteration: IterationNumber,
  weakMatterMode: boolean
): IterationRule {
  const rules = weakMatterMode
    ? DIAGNOSTIC_PROTOCOL.weakMatterIterationRules
    : DIAGNOSTIC_PROTOCOL.nominalIterationRules;

  const rule = rules.find((item) => item.iteration === iteration);

  if (!rule) {
    throw new Error(`No iteration rule found for iteration ${iteration}`);
  }

  return rule;
}

export function buildIterationCoverage(input: {
  dimensionId: DimensionId;
  iteration: IterationNumber;
  actualCount: number;
  weakMatterMode: boolean;
}): IterationCoverage {
  const rule = getIterationRule(input.iteration, input.weakMatterMode);

  return {
    dimensionId: input.dimensionId,
    iteration: input.iteration,
    targetCount: rule.targetCount,
    minimumCount: rule.minimumCount,
    actualCount: input.actualCount,
    weakMatterMode: input.weakMatterMode,
  };
}

export function isCoverageSufficient(coverage: IterationCoverage): boolean {
  return coverage.actualCount >= coverage.minimumCount;
}

export function getDimensionDefinition(
  dimensionId: DimensionId
): DimensionDefinition {
  const dimension = DIAGNOSTIC_PROTOCOL.dimensions.find(
    (item) => item.id === dimensionId
  );

  if (!dimension) {
    throw new Error(`Unknown dimension: ${dimensionId}`);
  }

  return dimension;
}

export function orderedDimensionIds(): DimensionId[] {
  return DIAGNOSTIC_PROTOCOL.dimensions.map((item) => item.id);
}

export function nextDimensionId(
  current: DimensionId
): DimensionId | null {
  const ordered = orderedDimensionIds();
  const index = ordered.indexOf(current);
  if (index < 0 || index >= ordered.length - 1) return null;
  return ordered[index + 1];
}

export function nextIterationNumber(
  current: IterationNumber
): IterationNumber | null {
  if (current === 1) return 2;
  if (current === 2) return 3;
  return null;
}

export function isLastIteration(iteration: IterationNumber): boolean {
  return iteration === 3;
}

export function isLastDimension(dimensionId: DimensionId): boolean {
  const ordered = orderedDimensionIds();
  return ordered[ordered.length - 1] === dimensionId;
}

export function buildIterationHeader(
  dimensionId: DimensionId,
  iteration: IterationNumber
): string {
  const dimension = getDimensionDefinition(dimensionId);
  return `${dimension.label} - Iteration ${iteration}/3`;
}

export function buildIterationClosurePrompt(
  dimensionId: DimensionId,
  iteration: IterationNumber
): string {
  const dimension = getDimensionDefinition(dimensionId);
  return `Merci de confirmer la cloture de l'iteration ${iteration} pour la dimension ${dimension.label}. Repondez par une validation ou une demande de reouverture motivee.`;
}
