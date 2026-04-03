// lib/bilan-sante/objective-knowledge.ts

import type { DimensionId } from "@/lib/bilan-sante/protocol";
import type { ObjectiveSeed, ZoneNonPilotee } from "@/lib/bilan-sante/session-model";
export type ObjectiveKnowledgeFamily =
  | "commercial_performance"
  | "pricing_margin_control"
  | "project_execution_control"
  | "management_rituals"
  | "role_clarity"
  | "resource_dependency"
  | "quality_reliability"
  | "cash_collection"
  | "planning_preparation"
  | "stability_preservation";

export type KnowledgeAction = {
  id: string;
  family: ObjectiveKnowledgeFamily;
  title: string;
  description: string;
};

export type KnowledgeIndicator = {
  id: string;
  family: ObjectiveKnowledgeFamily;
  label: string;
  description: string;
};

export type ObjectiveKnowledgeMatch = {
  family: ObjectiveKnowledgeFamily;
  actionIds: string[];
  indicatorIds: string[];
  resultObjectiveTemplate: (
    params: ObjectiveTemplateParams
  ) => string;
  quickWinTemplate: (
    params: ObjectiveTemplateParams
  ) => string;
  potentialGainTemplate: (
    params: ObjectiveTemplateParams
  ) => string;
  quantificationNotes: string[];
};

export type ObjectiveTemplateParams = {
  dimensionId: DimensionId;
  dimensionTitle: string;
  dominantRootCause: string;
  zone?: ZoneNonPilotee | null;
  focusLabel: string;
  evidenceSummary?: string[];
};

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: unknown): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function truncate(value: unknown, max = 180): string {
  const text = normalizeText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function extractQuotedTheme(value: unknown): string | null {
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

export function thematicFocusLabel(value: unknown): string {
  const theme = extractQuotedTheme(value);
  if (theme) return theme;

  const sentence = firstSentence(value)
    .replace(/^le\s+th[èe]me\s+/i, "")
    .replace(/^sur\s+le\s+th[èe]me\s+/i, "")
    .replace(/^la\s+zone\s+/i, "")
    .replace(/^le\s+point\s+/i, "")
    .replace(/^constat\s*:\s*/i, "")
    .replace(/^risque\s+manag[ée]rial\s*:\s*/i, "")
    .replace(/^cons[ée]quence\s*:\s*/i, "")
    .trim();

  return truncate(sentence, 120) || "zone non pilotée dominante";
}

export const KNOWLEDGE_ACTIONS: KnowledgeAction[] = [
  {
    id: "action-commercial-funnel",
    family: "commercial_performance",
    title: "Piloter le funnel commercial",
    description:
      "Structurer le pilotage du pipeline, la sélectivité et le taux de transformation des affaires.",
  },
  {
    id: "action-pricing-affair-control",
    family: "pricing_margin_control",
    title: "Gérer par affaire et sécuriser le chiffrage",
    description:
      "Relier décisions de prix, hypothèses de chiffrage, marge cible et retour d’expérience affaire.",
  },
  {
    id: "action-project-preparation",
    family: "planning_preparation",
    title: "Préparer les affaires et planifier l’exécution",
    description:
      "Sécuriser préparation, planification, ressources et points de passage critiques.",
  },
  {
    id: "action-execution-rituals",
    family: "project_execution_control",
    title: "Installer le pilotage d’exécution",
    description:
      "Rendre visibles les dérives, arbitrages, aléas et écarts sur l’exécution réelle.",
  },
  {
    id: "action-management-rituals",
    family: "management_rituals",
    title: "Construire un tableau de bord et des rituels",
    description:
      "Installer des rituels de revue, des indicateurs utiles et une logique de pilotage régulier.",
  },
  {
    id: "action-role-clarity",
    family: "role_clarity",
    title: "Clarifier rôles et responsabilités",
    description:
      "Sécuriser qui décide, qui arbitre, qui prépare, qui exécute et qui rend compte.",
  },
  {
    id: "action-dependency-relays",
    family: "resource_dependency",
    title: "Réduire la dépendance aux personnes clés",
    description:
      "Mettre en place relais, suppléances, formalisation et couverture des points de vulnérabilité.",
  },
  {
    id: "action-quality-reliability",
    family: "quality_reliability",
    title: "Sécuriser qualité et fiabilité d’exécution",
    description:
      "Réduire reprises, non-qualité, dérives de délai et incidents de réalisation.",
  },
  {
    id: "action-cash-collection",
    family: "cash_collection",
    title: "Renforcer la chaîne facturation / encaissement",
    description:
      "Relier production, avancement, facturation, encours et cash.",
  },
  {
    id: "action-stability-preservation",
    family: "stability_preservation",
    title: "Consolider un pilotage déjà robuste",
    description:
      "Documenter les mécanismes en place, sécuriser leur tenue dans le temps et éviter la rechute.",
  },
];

export const KNOWLEDGE_INDICATORS: KnowledgeIndicator[] = [
  {
    id: "ind-commercial-conversion",
    family: "commercial_performance",
    label: "Taux de transformation, volume d’opportunités actives, marge des affaires signées",
    description:
      "Mesure la qualité du pipeline, la sélectivité et l’efficacité commerciale rentable.",
  },
  {
    id: "ind-pricing-margin-gap",
    family: "pricing_margin_control",
    label: "Écart prix vendu / coût réel, marge à affaire, taux de dérive devis",
    description:
      "Mesure la robustesse du chiffrage, la tenue de la marge et les écarts structurels.",
  },
  {
    id: "ind-project-preparation",
    family: "planning_preparation",
    label: "Taux d’affaires préparées à temps, couverture planning / ressources, respect jalons amont",
    description:
      "Mesure la qualité de préparation et la capacité à sécuriser l’exécution avant démarrage.",
  },
  {
    id: "ind-execution-control",
    family: "project_execution_control",
    label: "Taux de dérives détectées à temps, tenue planning, taux d’écarts traités en revue",
    description:
      "Mesure la capacité à piloter l’exécution et à corriger les écarts avant qu’ils ne s’aggravent.",
  },
  {
    id: "ind-management-rituals",
    family: "management_rituals",
    label: "Fréquence des revues, taux de traitement des écarts, couverture du tableau de bord",
    description:
      "Mesure la régularité et l’efficacité des rituels de management.",
  },
  {
    id: "ind-role-clarity",
    family: "role_clarity",
    label: "Couverture des rôles clés, délai d’arbitrage, décisions prises au bon niveau",
    description:
      "Mesure la clarté des responsabilités et la fluidité de décision.",
  },
  {
    id: "ind-dependency-relays",
    family: "resource_dependency",
    label: "Taux de couverture des relais, points tenus sans personne clé, niveau de dépendance critique",
    description:
      "Mesure la fragilité liée aux personnes clés et la robustesse des relais.",
  },
  {
    id: "ind-quality-reliability",
    family: "quality_reliability",
    label: "Taux de non-conformité, reprises, fiabilité des délais, incidents d’exécution",
    description:
      "Mesure la qualité réelle d’exécution et ses conséquences opérationnelles.",
  },
  {
    id: "ind-cash-collection",
    family: "cash_collection",
    label: "Délai de facturation, encours, délai de recouvrement, visibilité cash",
    description:
      "Mesure la capacité à transformer l’activité produite en cash maîtrisé.",
  },
  {
    id: "ind-stability-preservation",
    family: "stability_preservation",
    label: "Tenue des délégations, continuité des relais, absence de dérive sur les thèmes explorés",
    description:
      "Mesure la stabilité d’un pilotage déjà jugé robuste.",
  },
];

const MATCHES: ObjectiveKnowledgeMatch[] = [
  {
    family: "commercial_performance",
    actionIds: ["action-commercial-funnel", "action-management-rituals"],
    indicatorIds: ["ind-commercial-conversion", "ind-management-rituals"],
    resultObjectiveTemplate: ({ focusLabel }) =>
      `Sous 6 mois, rendre pilotable "${focusLabel}" en fiabilisant le pilotage du pipeline, la sélectivité des affaires et la transformation rentable`,
    quickWinTemplate: ({ focusLabel }) =>
      `Dans les 30 jours, installer une revue pipeline ciblée sur "${focusLabel}" avec règles de qualification, de go / no go et de suivi des affaires prioritaires.`,
    potentialGainTemplate: ({ zone }) =>
      zone?.consequence
        ? `Gain à estimer prudemment sur la base de la conséquence identifiée : ${truncate(zone.consequence, 150)}. Hypothèse prioritaire : meilleure sélectivité et meilleure conversion rentable.`
        : "Gain à estimer prudemment sur l’amélioration de la conversion rentable, sans chiffre inventé.",
    quantificationNotes: [
      "Raisonner en amélioration de sélectivité, de taux de transformation et de marge des affaires signées.",
      "Ne pas inventer de volume commercial ; partir du pipeline réellement observé.",
    ],
  },
  {
    family: "pricing_margin_control",
    actionIds: ["action-pricing-affair-control", "action-management-rituals"],
    indicatorIds: ["ind-pricing-margin-gap", "ind-management-rituals"],
    resultObjectiveTemplate: ({ focusLabel }) =>
      `Sous 6 mois, rendre pilotable "${focusLabel}" en sécurisant les hypothèses de chiffrage, la discipline de prix et la tenue de la marge à affaire`,
    quickWinTemplate: ({ focusLabel }) =>
      `Dans les 30 jours, formaliser sur "${focusLabel}" une revue devis / hypothèses / marge cible sur les affaires les plus sensibles.`,
    potentialGainTemplate: ({ zone }) =>
      zone?.consequence
        ? `Gain à estimer prudemment sur la réduction des écarts prix vendu / coût réel, en lien avec : ${truncate(zone.consequence, 150)}.`
        : "Gain à estimer prudemment sur la réduction des dérives de marge et des écarts de chiffrage.",
    quantificationNotes: [
      "Raisonner en baisse des dérives de marge, de sous-chiffrage et de reprises non couvertes.",
      "S’appuyer sur des affaires connues ou sur un historique disponible ; jamais sur des chiffres inventés.",
    ],
  },
  {
    family: "planning_preparation",
    actionIds: ["action-project-preparation", "action-role-clarity"],
    indicatorIds: ["ind-project-preparation", "ind-role-clarity"],
    resultObjectiveTemplate: ({ focusLabel }) =>
      `Sous 6 mois, rendre pilotable "${focusLabel}" en sécurisant la préparation des affaires, l’affectation des ressources et les points de passage amont`,
    quickWinTemplate: ({ focusLabel }) =>
      `Dans les 30 jours, poser une check-list de préparation et un point de passage obligatoire sur "${focusLabel}" avant lancement ou engagement.`,
    potentialGainTemplate: ({ zone }) =>
      zone?.consequence
        ? `Gain à estimer prudemment sur les retards, reprises et dérives évitables liés à : ${truncate(zone.consequence, 150)}.`
        : "Gain à estimer prudemment sur la baisse des retards et des imprévus d’exécution liés à une préparation insuffisante.",
    quantificationNotes: [
      "Raisonner en évitement de retards, reprises, improductivités et urgences coûteuses.",
      "Ne pas inventer de taux ; documenter des ordres de grandeur prudents ou des gains potentiels qualitatifs.",
    ],
  },
  {
    family: "project_execution_control",
    actionIds: ["action-execution-rituals", "action-management-rituals"],
    indicatorIds: ["ind-execution-control", "ind-management-rituals"],
    resultObjectiveTemplate: ({ focusLabel }) =>
      `Sous 6 mois, rendre pilotable "${focusLabel}" en détectant plus tôt les dérives d’exécution et en sécurisant leur traitement managérial`,
    quickWinTemplate: ({ focusLabel }) =>
      `Dans les 30 jours, mettre en place une revue hebdomadaire d’exécution sur "${focusLabel}" avec suivi des écarts, arbitrages et actions de correction.`,
    potentialGainTemplate: ({ zone }) =>
      zone?.consequence
        ? `Gain à estimer prudemment sur la réduction des dérives d’exécution, en lien avec : ${truncate(zone.consequence, 150)}.`
        : "Gain à estimer prudemment sur la réduction des dérives de délai, de coût et de traitement tardif des écarts.",
    quantificationNotes: [
      "Raisonner en baisse des dérives détectées tardivement, des reprises et des urgences.",
      "Privilégier la logique de risque économique évité plutôt qu’un chiffre agressif.",
    ],
  },
  {
    family: "management_rituals",
    actionIds: ["action-management-rituals", "action-role-clarity"],
    indicatorIds: ["ind-management-rituals", "ind-role-clarity"],
    resultObjectiveTemplate: ({ focusLabel }) =>
      `Sous 6 mois, rendre pilotable "${focusLabel}" en installant des rituels de revue et des indicateurs réellement utilisés par le management`,
    quickWinTemplate: ({ focusLabel }) =>
      `Dans les 30 jours, définir sur "${focusLabel}" un propriétaire, 3 indicateurs utiles et un rituel de revue explicite.`,
    potentialGainTemplate: ({ zone }) =>
      zone?.consequence
        ? `Gain à estimer prudemment sur la réduction des écarts non vus et des décisions tardives, en lien avec : ${truncate(zone.consequence, 150)}.`
        : "Gain à estimer prudemment sur la visibilité managériale retrouvée et la baisse des écarts non traités.",
    quantificationNotes: [
      "Raisonner en temps gagné, décisions prises plus tôt et baisse des écarts non traités.",
      "Ne pas surpromettre un gain économique direct si le lien causal n’est pas démontré.",
    ],
  },
  {
    family: "role_clarity",
    actionIds: ["action-role-clarity", "action-management-rituals"],
    indicatorIds: ["ind-role-clarity", "ind-management-rituals"],
    resultObjectiveTemplate: ({ focusLabel }) =>
      `Sous 6 mois, rendre pilotable "${focusLabel}" en clarifiant les rôles, les arbitrages et les responsabilités associés`,
    quickWinTemplate: ({ focusLabel }) =>
      `Dans les 30 jours, cartographier sur "${focusLabel}" qui décide, qui prépare, qui valide et qui suit les écarts.`,
    potentialGainTemplate: ({ zone }) =>
      zone?.consequence
        ? `Gain à estimer prudemment sur la réduction des blocages et des délais d’arbitrage, en lien avec : ${truncate(zone.consequence, 150)}.`
        : "Gain à estimer prudemment sur la baisse des blocages, doublons et décisions prises trop tard.",
    quantificationNotes: [
      "Raisonner en délai d’arbitrage réduit, meilleure fluidité et moins de re-travail décisionnel.",
      "Utiliser des hypothèses prudentes et explicites.",
    ],
  },
  {
    family: "resource_dependency",
    actionIds: ["action-dependency-relays", "action-role-clarity"],
    indicatorIds: ["ind-dependency-relays", "ind-role-clarity"],
    resultObjectiveTemplate: ({ focusLabel }) =>
      `Sous 6 mois, rendre pilotable "${focusLabel}" en réduisant la dépendance aux personnes clés et en sécurisant les relais`,
    quickWinTemplate: ({ focusLabel }) =>
      `Dans les 30 jours, identifier sur "${focusLabel}" les points de dépendance critique et nommer les relais ou suppléances prioritaires.`,
    potentialGainTemplate: ({ zone }) =>
      zone?.consequence
        ? `Gain à estimer prudemment sur le risque économique évité lié à la dépendance critique, en lien avec : ${truncate(zone.consequence, 150)}.`
        : "Gain à estimer prudemment sur le risque évité lié aux points de dépendance et aux relais insuffisants.",
    quantificationNotes: [
      "Raisonner en risque évité, continuité d’activité et réduction de fragilité organisationnelle.",
      "Ne pas inventer un gain de productivité si le sujet est d’abord un sujet de robustesse.",
    ],
  },
  {
    family: "quality_reliability",
    actionIds: ["action-quality-reliability", "action-execution-rituals"],
    indicatorIds: ["ind-quality-reliability", "ind-execution-control"],
    resultObjectiveTemplate: ({ focusLabel }) =>
      `Sous 6 mois, rendre pilotable "${focusLabel}" en réduisant les non-conformités, reprises et dérives de fiabilité associées`,
    quickWinTemplate: ({ focusLabel }) =>
      `Dans les 30 jours, ouvrir sur "${focusLabel}" un suivi simple des non-conformités, reprises et causes récurrentes.`,
    potentialGainTemplate: ({ zone }) =>
      zone?.consequence
        ? `Gain à estimer prudemment sur la baisse des reprises et incidents, en lien avec : ${truncate(zone.consequence, 150)}.`
        : "Gain à estimer prudemment sur la réduction des reprises, non-qualités et retards associés.",
    quantificationNotes: [
      "Raisonner en coût de non-qualité évité, baisse des reprises et amélioration de fiabilité.",
      "Privilégier les liens documentés avec les incidents réellement observés.",
    ],
  },
  {
    family: "cash_collection",
    actionIds: ["action-cash-collection", "action-management-rituals"],
    indicatorIds: ["ind-cash-collection", "ind-management-rituals"],
    resultObjectiveTemplate: ({ focusLabel }) =>
      `Sous 6 mois, rendre pilotable "${focusLabel}" en reliant plus étroitement avancement, facturation, encours et cash`,
    quickWinTemplate: ({ focusLabel }) =>
      `Dans les 30 jours, mettre sous revue sur "${focusLabel}" les encours, blocages de facturation et points de recouvrement critiques.`,
    potentialGainTemplate: ({ zone }) =>
      zone?.consequence
        ? `Gain à estimer prudemment sur le cash et les encours, en lien avec : ${truncate(zone.consequence, 150)}.`
        : "Gain à estimer prudemment sur la réduction des encours, des délais de facturation et des retards d’encaissement.",
    quantificationNotes: [
      "Raisonner en encours réduits, cash plus visible et délais de facturation / recouvrement raccourcis.",
      "Aucun chiffre inventé : partir des encours ou blocages connus.",
    ],
  },
  {
    family: "stability_preservation",
    actionIds: ["action-stability-preservation"],
    indicatorIds: ["ind-stability-preservation"],
    resultObjectiveTemplate: ({ dimensionTitle }) =>
      `Sous 6 mois, consolider dans la durée les mécanismes de pilotage déjà en place sur la dimension "${dimensionTitle}"`,
    quickWinTemplate: ({ focusLabel }) =>
      `Dans les 30 jours, documenter brièvement les règles, relais et points de revue qui rendent "${focusLabel}" aujourd’hui maîtrisé.`,
    potentialGainTemplate: () =>
      "Gain à estimer prudemment sur la préservation de la robustesse constatée et le risque de rechute évité.",
    quantificationNotes: [
      "Raisonner en robustesse maintenue, risque évité et prévention d’une dégradation future.",
      "Ne pas forcer un gain économique direct quand la logique est d’abord préventive.",
    ],
  },
];

function familyKeywords(text: string): ObjectiveKnowledgeFamily {
  if (
    text.includes("pipeline") ||
    text.includes("commercial") ||
    text.includes("prospection") ||
    text.includes("transformation") ||
    text.includes("marche") ||
    text.includes("marché")
  ) {
    return "commercial_performance";
  }

  if (
    text.includes("prix") ||
    text.includes("chiffrage") ||
    text.includes("devis") ||
    text.includes("marge") ||
    text.includes("cout") ||
    text.includes("coût") ||
    text.includes("rentabil")
  ) {
    return "pricing_margin_control";
  }

  if (
    text.includes("cash") ||
    text.includes("encours") ||
    text.includes("facturation") ||
    text.includes("recouvrement") ||
    text.includes("tresorerie") ||
    text.includes("trésorerie")
  ) {
    return "cash_collection";
  }

  if (
    text.includes("non qualite") ||
    text.includes("non qualité") ||
    text.includes("reprise") ||
    text.includes("incident") ||
    text.includes("conformite") ||
    text.includes("conformité")
  ) {
    return "quality_reliability";
  }

  if (
    text.includes("preparation") ||
    text.includes("préparation") ||
    text.includes("planning") ||
    text.includes("jalon") ||
    text.includes("ressource") ||
    text.includes("charge")
  ) {
    return "planning_preparation";
  }

  if (
    text.includes("depend") ||
    text.includes("dépend") ||
    text.includes("personne cle") ||
    text.includes("personne clé") ||
    text.includes("relais")
  ) {
    return "resource_dependency";
  }

  if (
    text.includes("arbitr") ||
    text.includes("validation") ||
    text.includes("decision") ||
    text.includes("décision") ||
    text.includes("role") ||
    text.includes("rôle") ||
    text.includes("responsabil")
  ) {
    return "role_clarity";
  }

  if (
    text.includes("rituel") ||
    text.includes("tableau de bord") ||
    text.includes("indicateur") ||
    text.includes("pilotage")
  ) {
    return "management_rituals";
  }

  if (
    text.includes("execution") ||
    text.includes("exécution") ||
    text.includes("derive") ||
    text.includes("dérive") ||
    text.includes("delai") ||
    text.includes("délai")
  ) {
    return "project_execution_control";
  }

  return "stability_preservation";
}

export function detectObjectiveKnowledgeFamily(params: {
  dominantRootCause: string;
  zone?: ZoneNonPilotee | null;
  evidenceSummary?: string[];
}): ObjectiveKnowledgeFamily {
  const text = normalizeForMatch(
    [
      params.dominantRootCause,
      params.zone?.constat ?? "",
      params.zone?.risqueManagerial ?? "",
      params.zone?.consequence ?? "",
      ...(params.evidenceSummary ?? []),
    ].join(" ")
  );

  if (text.includes("aucune cause racine critique")) {
    return "stability_preservation";
  }

  return familyKeywords(text);
}

export function getKnowledgeMatch(
  family: ObjectiveKnowledgeFamily
): ObjectiveKnowledgeMatch {
  return (
    MATCHES.find((item) => item.family === family) ??
    MATCHES.find((item) => item.family === "stability_preservation")!
  );
}

export function getKnowledgeActions(actionIds: string[]): KnowledgeAction[] {
  const ids = new Set(actionIds);
  return KNOWLEDGE_ACTIONS.filter((item) => ids.has(item.id));
}

export function getKnowledgeIndicators(indicatorIds: string[]): KnowledgeIndicator[] {
  const ids = new Set(indicatorIds);
  return KNOWLEDGE_INDICATORS.filter((item) => ids.has(item.id));
}

export function buildKnowledgeSeed(params: {
  dimensionId: DimensionId;
  dimensionTitle: string;
  dominantRootCause: string;
  consolidatedFindings: [string, string, string];
  evidenceSummary?: string[];
  zone?: ZoneNonPilotee | null;
  priorityScore?: number;
  priority?: "high" | "medium" | "low";
  seedId: string;
}): ObjectiveSeed {
  const focusLabel = thematicFocusLabel(params.zone?.constat ?? params.consolidatedFindings[0]);
  const family = detectObjectiveKnowledgeFamily({
    dominantRootCause: params.dominantRootCause,
    zone: params.zone,
    evidenceSummary: params.evidenceSummary,
  });
  const match = getKnowledgeMatch(family);

  return {
    id: params.seedId,
    label: match.resultObjectiveTemplate({
      dimensionId: params.dimensionId,
      dimensionTitle: params.dimensionTitle,
      dominantRootCause: params.dominantRootCause,
      zone: params.zone,
      focusLabel,
      evidenceSummary: params.evidenceSummary,
    }),
    rationale: normalizeText(
      [
        params.zone?.constat ?? params.consolidatedFindings[0],
        params.zone?.risqueManagerial ? `Risque : ${params.zone.risqueManagerial}` : "",
      ].join(" ")
    ),
    indicator: getKnowledgeIndicators(match.indicatorIds)[0]?.label,
    suggestedDueDate:
      params.priority === "high"
        ? "90 jours pour sécuriser le cadre / 6 mois pour tenir le résultat"
        : params.priority === "medium"
        ? "6 mois avec premier jalon à 90 jours"
        : "Revue à 3 mois puis stabilisation à 6 mois",
    potentialGain: match.potentialGainTemplate({
      dimensionId: params.dimensionId,
      dimensionTitle: params.dimensionTitle,
      dominantRootCause: params.dominantRootCause,
      zone: params.zone,
      focusLabel,
      evidenceSummary: params.evidenceSummary,
    }),
    quickWin: match.quickWinTemplate({
      dimensionId: params.dimensionId,
      dimensionTitle: params.dimensionTitle,
      dominantRootCause: params.dominantRootCause,
      zone: params.zone,
      focusLabel,
      evidenceSummary: params.evidenceSummary,
    }),
    priority: params.priority,
    priorityScore: params.priorityScore,
    objectiveFamily: family,
    knowledgeActionIds: match.actionIds,
    knowledgeIndicatorIds: match.indicatorIds,
    quantificationNotes: match.quantificationNotes,
  };
}