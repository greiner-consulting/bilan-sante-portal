// lib/bilan-sante/objectives-builder.ts

import { FINAL_OBJECTIVES_HEADER, dimensionTitle, type DimensionId } from "@/lib/bilan-sante/protocol";
import type {
  DiagnosticSessionAggregate,
  FinalObjective,
  FinalObjectiveSet,
  FrozenDimensionDiagnosis,
} from "@/lib/bilan-sante/session-model";

export type ObjectiveDecisionInput = {
  objectiveId: string;
  status: "validated" | "adjusted" | "refused";
  adjustedLabel?: string;
  adjustedIndicator?: string;
  adjustedDueDate?: string;
  adjustedPotentialGain?: string;
  adjustedQuickWin?: string;
};

function strongestZone(frozen: FrozenDimensionDiagnosis) {
  return frozen.unmanagedZones[0] ?? {
    constat: frozen.consolidatedFindings[0],
    risqueManagerial:
      "Risque managérial à préciser à partir du diagnostic gelé de la dimension.",
    consequence:
      "Conséquence économique ou opérationnelle à expliciter prudemment avec les données disponibles.",
  };
}

function defaultOwner(dimensionId: DimensionId): string {
  if (dimensionId === 1) return "Dirigeant / Responsable RH / Encadrement";
  if (dimensionId === 2) return "Dirigeant / Responsable commercial";
  if (dimensionId === 3) return "Dirigeant / Responsable offres / commerce";
  return "Dirigeant / Responsable opérationnel";
}

function resultObjectiveLabel(frozen: FrozenDimensionDiagnosis): string {
  const zone = strongestZone(frozen);

  switch (frozen.dimensionId) {
    case 1:
      return `Réduire la dépendance de l’organisation à des arbitrages non sécurisés en élevant le niveau réel de maîtrise des rôles, relais et capacités critiques exposés par : ${zone.constat}`;
    case 2:
      return `Accroître la part de croissance réellement rentable en sécurisant le ciblage, le déploiement commercial et la visibilité pipeline dégradés par : ${zone.constat}`;
    case 3:
      return `Élever la part d’affaires vendues avec une marge réellement maîtrisée en réduisant les écarts issus de : ${zone.constat}`;
    case 4:
      return `Réduire les dérives d’exécution qui dégradent qualité, marge, cash ou productivité à partir de la fragilité révélée par : ${zone.constat}`;
    default:
      return `Réduire l’exposition de la dimension à la zone non pilotée dominante : ${zone.constat}`;
  }
}

function keyIndicator(frozen: FrozenDimensionDiagnosis): string {
  switch (frozen.dimensionId) {
    case 1:
      return "Taux de couverture des rôles critiques / stabilité des relais / incidents liés au flou de responsabilités";
    case 2:
      return "Taux de transformation rentable / visibilité pipeline / concentration du portefeuille";
    case 3:
      return "Part des affaires vendues avec marge conforme à la cible / écart prix vendu vs coût réel";
    case 4:
      return "Taux de dérive opérationnelle / tenue de marge / incidents qualité ou productivité";
    default:
      return "Indicateur clé de maîtrise de la zone non pilotée dominante";
  }
}

function defaultDueDate(frozen: FrozenDimensionDiagnosis): string {
  if (frozen.score <= 2) return "90 jours";
  if (frozen.score === 3) return "120 jours";
  return "180 jours";
}

function potentialGain(frozen: FrozenDimensionDiagnosis): string {
  switch (frozen.dimensionId) {
    case 1:
      return "Fourchette prudente : gain potentiel surtout indirect, de niveau modéré à significatif sur continuité d’exécution, qualité de décision et tenue des engagements, sous hypothèses explicites.";
    case 2:
      return "Fourchette prudente : gain potentiel modéré à significatif sur croissance rentable et sélectivité commerciale, à préciser avec données disponibles.";
    case 3:
      return "Fourchette prudente : gain potentiel significatif sur marge d’affaires, sélectivité et protection du résultat, sans chiffrage inventé.";
    case 4:
      return "Fourchette prudente : gain potentiel modéré à significatif sur marge, cash, qualité et productivité, à objectiver par ordres de grandeur.";
    default:
      return "Fourchette prudente : gain potentiel à préciser avec hypothèses explicites et données disponibles.";
  }
}

function gainHypotheses(frozen: FrozenDimensionDiagnosis): string[] {
  const zone = strongestZone(frozen);

  return [
    "Aucun chiffre précis n’est inventé.",
    "La quantification doit être exprimée en fourchette prudente / ordre de grandeur.",
    `La fourchette s’appuie d’abord sur la conséquence probable suivante : ${zone.consequence}`,
    `La cause racine dominante retenue pour cette dimension est : ${frozen.dominantRootCause}`,
  ];
}

function quickWin(frozen: FrozenDimensionDiagnosis): string {
  const zone = strongestZone(frozen);

  switch (frozen.dimensionId) {
    case 1:
      return `Sécuriser immédiatement le point d’exposition suivant : ${zone.constat}`;
    case 2:
      return `Rendre visible en comité de pilotage le point suivant : ${zone.constat}`;
    case 3:
      return `Bloquer rapidement la dérive la plus exposante : ${zone.constat}`;
    case 4:
      return `Mettre sous revue rapprochée le point suivant : ${zone.constat}`;
    default:
      return `Traiter prioritairement : ${zone.constat}`;
  }
}

function buildObjective(frozen: FrozenDimensionDiagnosis, index: number): FinalObjective {
  return {
    id: `obj-d${frozen.dimensionId}-${index}`,
    dimensionId: frozen.dimensionId,
    objectiveLabel: resultObjectiveLabel(frozen),
    owner: defaultOwner(frozen.dimensionId),
    keyIndicator: keyIndicator(frozen),
    dueDate: defaultDueDate(frozen),
    potentialGain: potentialGain(frozen),
    gainHypotheses: gainHypotheses(frozen),
    validationStatus: "proposed",
    quickWin: quickWin(frozen),
  };
}

function dedupeByDimension(frozenDimensions: FrozenDimensionDiagnosis[]): FrozenDimensionDiagnosis[] {
  const seen = new Set<number>();
  const out: FrozenDimensionDiagnosis[] = [];

  for (const frozen of [...frozenDimensions].sort((a, b) => a.dimensionId - b.dimensionId)) {
    if (seen.has(frozen.dimensionId)) continue;
    seen.add(frozen.dimensionId);
    out.push(frozen);
  }

  return out;
}

export function buildFinalObjectiveSet(session: DiagnosticSessionAggregate): FinalObjectiveSet {
  const frozenDimensions = dedupeByDimension(session.frozenDimensions);

  const objectives = frozenDimensions.map((frozen, index) => buildObjective(frozen, index + 1));

  return {
    header: FINAL_OBJECTIVES_HEADER,
    objectives,
  };
}

export function applyObjectiveDecisionsToSet(
  objectiveSet: FinalObjectiveSet,
  decisions: ObjectiveDecisionInput[]
): FinalObjectiveSet {
  const decisionsById = new Map(decisions.map((d) => [d.objectiveId, d]));

  const objectives = objectiveSet.objectives.map((objective) => {
    const decision = decisionsById.get(objective.id);
    if (!decision) return objective;

    return {
      ...objective,
      objectiveLabel:
        decision.status === "adjusted" && decision.adjustedLabel
          ? decision.adjustedLabel
          : objective.objectiveLabel,
      keyIndicator:
        decision.status === "adjusted" && decision.adjustedIndicator
          ? decision.adjustedIndicator
          : objective.keyIndicator,
      dueDate:
        decision.status === "adjusted" && decision.adjustedDueDate
          ? decision.adjustedDueDate
          : objective.dueDate,
      potentialGain:
        decision.status === "adjusted" && decision.adjustedPotentialGain
          ? decision.adjustedPotentialGain
          : objective.potentialGain,
      quickWin:
        decision.status === "adjusted" && decision.adjustedQuickWin
          ? decision.adjustedQuickWin
          : objective.quickWin,
      validationStatus: decision.status,
    };
  });

  return {
    ...objectiveSet,
    objectives,
    decisionsCapturedAt: new Date().toISOString(),
  };
}
