import type { DimensionId } from "@/lib/diagnostic/knowledgeBase";

export type IterationMode = "normal" | "reopen_after_no";

export type DimensionGuardrails = {
  name: string;
  iterationTitles: Record<number, string>;
  investigationGoals: string[];
  allowedThemes: string[];
  forbiddenThemes: string[];
  evidenceExpectations: string[];
  confusionRisks: string[];
  economicAngles: string[];
};

export const DIMENSION_GUARDRAILS: Record<number, DimensionGuardrails> = {
  1: {
    name: "Organisation & RH",
    iterationTitles: {
      1: "Cadrage & compréhension initiale",
      2: "Approfondissement (causes, arbitrages, mécanismes)",
      3: "Stabilisation & cause racine",
    },
    investigationGoals: [
      "clarifier la gouvernance réelle et les responsabilités effectives",
      "identifier les dépendances humaines et les postes critiques",
      "comprendre la capacité réelle de l'encadrement à faire exécuter",
      "évaluer la robustesse des relais managériaux",
      "tester l'adéquation entre structure, charge et stratégie réelle",
    ],
    allowedThemes: [
      "gouvernance",
      "roles et responsabilites",
      "ligne manageriale",
      "relais d'encadrement",
      "competences critiques",
      "dependances humaines",
      "recrutement",
      "remplacement de profils inadaptés",
      "climat social",
      "adhesion des equipes",
      "management de proximite",
      "rituels manageriaux",
      "capacite d'execution managériale",
      "organisation interne",
      "structure de pilotage",
      "dimensionnement structure",
      "autonomie encadrement",
    ],
    forbiddenThemes: [
      "pricing",
      "tarification",
      "prix",
      "negociation tarifaire",
      "marge affaire detaillee",
      "taux de conversion commercial detaille",
      "segmentation client detaillee",
      "pipeline commercial detaille",
      "prospection pure",
      "positionnement marche detaille",
    ],
    evidenceExpectations: [
      "exemples concrets de décisions ou d'absence d'arbitrage",
      "description des rôles réellement tenus et non seulement théoriques",
      "cas de dépendance à quelques personnes",
      "preuves de fonctionnement ou de faiblesse des rituels managériaux",
      "ordres de grandeur de charge, sous-charge ou sureffectif",
    ],
    confusionRisks: [
      "ne pas glisser vers la performance commerciale pure",
      "ne pas traiter les prix ou la marge par affaire en détail",
      "ne pas détailler l'exécution chantier sauf sous l'angle du pilotage humain",
    ],
    economicAngles: [
      "sous-charge",
      "sureffectif",
      "centralisation dirigeant",
      "fragilité encadrement",
      "désalignement entre stratégie et structure",
    ],
  },
  2: {
    name: "Commercial & Marchés",
    iterationTitles: {
      1: "Réalité du positionnement",
      2: "Solidité du modèle commercial",
      3: "Maturité stratégique & viabilité",
    },
    investigationGoals: [
      "évaluer la qualité du portefeuille et la dépendance clients",
      "comprendre la logique de prospection et de ciblage",
      "identifier la discipline commerciale réelle",
      "qualifier les angles de conquête et de diversification",
      "tester la viabilité du modèle de croissance hors client historique",
    ],
    allowedThemes: [
      "segmentation clients",
      "prospection",
      "ciblage commercial",
      "portefeuille clients",
      "diversification",
      "positionnement marche",
      "proposition de valeur",
      "qualification opportunites",
      "pipeline",
      "funnel",
      "conversion",
      "animation commerciale",
      "priorisation opportunites",
      "motifs de gain ou de perte",
      "strategie de conquete",
      "dependance client",
      "machine commerciale",
      "focalisation sectorielle",
    ],
    forbiddenThemes: [
      "roles managériaux detaillees",
      "climat social",
      "dependances humaines",
      "prix de vente détaillé",
      "negociation tarifaire fine",
      "selectivite economique détaillée",
      "pilotage production detaille",
    ],
    evidenceExpectations: [
      "exemples de pertes ou gains d'affaires",
      "description du portefeuille et de ses concentrations",
      "preuves de prospection ou d'absence de prospection",
      "explication des priorités de marché réellement appliquées",
      "ordres de grandeur de transformation, volume d'offres, concentration client",
    ],
    confusionRisks: [
      "ne pas glisser vers les prix détaillés",
      "ne pas analyser l'organisation RH de manière générale",
      "ne pas basculer dans l'exécution opérationnelle sauf pour expliquer la valeur commerciale",
    ],
    economicAngles: [
      "dependance client",
      "taux de transformation",
      "taille de contrat",
      "focalisation sectorielle",
      "viabilite hors client historique",
    ],
  },
  3: {
    name: "Cycle de vente & Prix",
    iterationTitles: {
      1: "Solidité du processus d’acquisition",
      2: "Rentabilité réelle du processus",
      3: "Robustesse économique du modèle",
    },
    investigationGoals: [
      "comprendre la logique de formation du prix",
      "évaluer la discipline de négociation et de sélectivité",
      "identifier les dérives de marge avant signature",
      "comprendre les critères de go/no go",
      "mesurer le coût réel de la machine d'acquisition",
    ],
    allowedThemes: [
      "prix",
      "tarification",
      "positionnement prix",
      "negociation",
      "marge",
      "rentabilite affaire",
      "selectivite economique",
      "arbitrage go/no go",
      "cycle de vente",
      "duree cycle commercial",
      "conditions de negociation",
      "criteres de poursuite d'affaire",
      "discipline commerciale economique",
      "capitalisation affaires gagnees/perdues",
      "cout de chiffrage",
      "marge vendue vs realisee",
      "volume d'offres",
    ],
    forbiddenThemes: [
      "climat social",
      "ligne manageriale",
      "recrutement",
      "segmentation marche generaliste",
      "prospection pure",
      "diversification portefeuille au sens large",
    ],
    evidenceExpectations: [
      "exemples d'affaires où le prix a été dégradé",
      "cas de négociation perdue ou gagnée",
      "preuves de marge cible ou d'absence de garde-fous",
      "description des arbitrages go/no go",
      "volume d'offres, temps de chiffrage, besoin de croissance ou absorption de structure",
    ],
    confusionRisks: [
      "ne pas revenir à la prospection générale",
      "ne pas traiter les sujets RH",
      "ne pas basculer dans l'exécution détaillée sauf si elle explique la marge réalisée",
    ],
    economicAngles: [
      "go/no-go",
      "cout d'acquisition",
      "marge vendue vs realisee",
      "volume d'offres",
      "croissance necessaire",
    ],
  },
  4: {
    name: "Exécution & Performance opérationnelle",
    iterationTitles: {
      1: "Réalité opérationnelle",
      2: "Mécanismes de dérive",
      3: "Robustesse opérationnelle",
    },
    investigationGoals: [
      "évaluer la qualité de pilotage opérationnel réel",
      "identifier les causes de dérive délais/qualité/productivité",
      "comprendre les interfaces commerce-etudes-production-terrain",
      "repérer les zones non pilotées dans l'exécution",
      "tester la robustesse de l'exécution hors environnement historique",
    ],
    allowedThemes: [
      "execution",
      "pilotage operationnel",
      "qualite",
      "delais",
      "productivite",
      "rentabilite execution",
      "derives",
      "traitement des ecarts",
      "coordination commerce-etudes-production-terrain",
      "arbitrage des priorites",
      "charge et capacite",
      "rituels de pilotage operationnel",
      "causes de non-performance",
      "amelioration continue",
      "preparation chantier",
      "discipline operationnelle",
      "gestion documentaire",
      "standards d'execution",
    ],
    forbiddenThemes: [
      "climat social general",
      "recrutement generaliste",
      "prospection",
      "segmentation client",
      "pipeline commercial",
      "conversion commerciale",
      "positionnement prix",
      "negociation tarifaire",
    ],
    evidenceExpectations: [
      "exemples de dérives concrètes",
      "écarts entre prévu et réalisé",
      "preuves de coordination ou de rupture d'interface",
      "existence ou absence de rituels de pilotage",
      "éléments sur litiges, documentation, productivité, BFR, stabilité d'exécution",
    ],
    confusionRisks: [
      "ne pas revenir au commercial pur",
      "ne pas basculer vers les prix",
      "ne pas analyser le RH hors impact direct sur l'exécution",
    ],
    economicAngles: [
      "productivite",
      "retards de facturation",
      "defauts documentaires",
      "courbe d'apprentissage",
      "marge + tresorerie",
    ],
  },
};

export function clampDimension(d: number) {
  return Math.min(Math.max(Number(d || 1), 1), 4);
}

export function clampIteration(i: number) {
  return Math.min(Math.max(Number(i || 1), 1), 3);
}

export function toDimensionKey(dimension: number): "1" | "2" | "3" | "4" {
  return String(clampDimension(dimension)) as "1" | "2" | "3" | "4";
}

export function dimensionName(dimension: number) {
  return DIMENSION_GUARDRAILS[dimension]?.name ?? "Dimension";
}

export function iterationTitle(dimension: number, iteration: number) {
  return (
    DIMENSION_GUARDRAILS[dimension]?.iterationTitles?.[iteration] ??
    `Itération ${iteration}/3`
  );
}

export function expectedQuestionCount(
  iteration: number,
  mode: IterationMode = "normal"
) {
  if (mode === "reopen_after_no") return 3;
  if (iteration === 1) return 6;
  if (iteration === 2) return 6;
  return 5;
}

export function hasExpectedBatchSize(
  batch: unknown[],
  iteration: number,
  mode: IterationMode = "normal"
) {
  return Array.isArray(batch) && batch.length === expectedQuestionCount(iteration, mode);
}

export function factTypeForDimension(dimension: number) {
  if (dimension === 1) return "organisational_fact";
  if (dimension === 2) return "commercial_fact";
  if (dimension === 3) return "economic_fact";
  return "operational_fact";
}

export function getIterationStrategy(iteration: number) {
  if (iteration === 1) {
    return {
      objective:
        "cadrer le fonctionnement réel, obtenir des descriptions concrètes, des ordres de grandeur et des exemples observables",
      forbidden:
        "ne pas chercher trop tôt des causes racines complexes ; ne pas reformuler abstraitement la trame",
      preferredIntents: [
        "initial_understanding",
        "examples_cases",
        "quantification",
        "frequency_timing",
        "decision_rights",
      ],
    };
  }

  if (iteration === 2) {
    return {
      objective:
        "approfondir les incohérences, mécanismes, arbitrages et écarts entre théorie et pratique",
      forbidden:
        "ne pas reposer la même question que l'itération 1 sous une autre forme",
      preferredIntents: [
        "cause_explanation",
        "arbitration",
        "real_life_mechanism",
        "examples_cases",
        "quantification",
      ],
    };
  }

  return {
    objective:
      "stabiliser les hypothèses fortes, tester les causes racines les plus crédibles et distinguer symptôme, cause et effet",
    forbidden:
      "ne pas refaire du simple cadrage descriptif ; creuser les explications structurelles",
    preferredIntents: [
      "cause_explanation",
      "arbitration",
      "real_life_mechanism",
      "frequency_timing",
      "quantification",
    ],
  };
}

export function dimensionId(dimension: number): DimensionId {
  return clampDimension(dimension) as DimensionId;
}