export type DimensionId = 1 | 2 | 3 | 4;
export type IterationNumber = 1 | 2 | 3;
export type ValidationDecision = "yes" | "no";
export type DimensionKey = "d1" | "d2" | "d3" | "d4";

export type DiagnosticDimensionDefinition = {
  id: DimensionId;
  key: DimensionKey;
  title: string;
  shortTitle: string;
  requiredThemes: string[];
};

export const FINAL_OBJECTIVES_HEADER =
  "Itération finale — validation dirigeant (objectifs & gains)";

export const DIAGNOSTIC_DIMENSIONS: DiagnosticDimensionDefinition[] = [
  {
    id: 1,
    key: "d1",
    title: "Organisation & Ressources Humaines",
    shortTitle: "Organisation & RH",
    requiredThemes: [
      "qualité et adéquation des équipes",
      "ressources vs charge",
      "turnover absentéisme stabilité",
      "recrutement et intégration",
      "clarté des rôles",
    ],
  },
  {
    id: 2,
    key: "d2",
    title: "Commercial & Marchés",
    shortTitle: "Commercial & Marchés",
    requiredThemes: [
      "stratégie commerciale",
      "portage managérial et déploiement réel",
      "indicateurs funnel / taux de succès",
      "capacité à générer une croissance rentable",
    ],
  },
  {
    id: 3,
    key: "d3",
    title: "Cycle de vente, offres & prix",
    shortTitle: "Cycle de vente & Prix",
    requiredThemes: [
      "construction du prix et hypothèses",
      "délégation et arbitrage",
      "fiabilité du chiffrage",
      "taux de succès et critères",
      "maîtrise des écarts prix vendu / coût réel",
    ],
  },
  {
    id: 4,
    key: "d4",
    title: "Exécution & Performance opérationnelle",
    shortTitle: "Exécution & Performance opérationnelle",
    requiredThemes: [
      "sécurité qualité performance économique",
      "indicateurs et rituels managériaux",
      "productivité et gestion des effectifs",
      "pilotage cash résultat marges",
    ],
  },
];

export function getDimensionDefinition(
  dimensionId: DimensionId
): DiagnosticDimensionDefinition {
  const found = DIAGNOSTIC_DIMENSIONS.find((d) => d.id === dimensionId);

  if (!found) {
    throw new Error(`Unknown dimension id: ${dimensionId}`);
  }

  return found;
}

export function dimensionKey(dimensionId: DimensionId): DimensionKey {
  return getDimensionDefinition(dimensionId).key;
}

export function dimensionTitle(dimensionId: DimensionId): string {
  return getDimensionDefinition(dimensionId).shortTitle;
}

export function buildIterationHeader(
  dimensionId: DimensionId,
  iteration: IterationNumber
): string {
  return `Dimension ${dimensionId} — Itération ${iteration}/3 — ${dimensionTitle(
    dimensionId
  )}`;
}

export function buildIterationClosurePrompt(
  dimensionId: DimensionId,
  iteration: IterationNumber
): string {
  const scope = `Clôturez-vous l’itération ${iteration}/3 de la dimension ${dimensionId} (${dimensionTitle(
    dimensionId
  )}) sur la base des réponses enregistrées ?`;

  return `${scope} Merci de répondre uniquement par "oui" ou "non".`;
}

/**
 * Cadre méthodologique haut niveau.
 * Le moteur réel de fermeture doit désormais s’appuyer sur le workset
 * effectivement construit, pas sur cette valeur seule.
 */
export function maxQuestionsForIteration(
  iteration: IterationNumber
): number {
  switch (iteration) {
    case 1:
      return 6;
    case 2:
      return 6;
    case 3:
      return 6;
    default:
      return 6;
  }
}

/**
 * Plancher méthodologique : en dessous de 3, on considère que l’itération
 * manque de matière, sauf cas d’exception explicite géré par le moteur.
 */
export function minimumFloorForIteration(
  iteration: IterationNumber
): number {
  switch (iteration) {
    case 1:
      return 3;
    case 2:
      return 3;
    case 3:
      return 3;
    default:
      return 3;
  }
}

/**
 * Compat descendante temporaire.
 * À terme, remplacer tous les usages par minimumFloorForIteration / workset.
 */
export function minQuestionsForIteration(
  iteration: IterationNumber
): number {
  return minimumFloorForIteration(iteration);
}

export function isLastIteration(
  iteration: IterationNumber
): boolean {
  return iteration === 3;
}

export function nextIterationNumber(
  iteration: IterationNumber
): IterationNumber | null {
  if (iteration === 1) return 2;
  if (iteration === 2) return 3;
  return null;
}

export function isLastDimension(
  dimensionId: DimensionId
): boolean {
  return dimensionId === 4;
}

export function nextDimensionId(
  dimensionId: DimensionId
): DimensionId | null {
  if (dimensionId === 1) return 2;
  if (dimensionId === 2) return 3;
  if (dimensionId === 3) return 4;
  return null;
}