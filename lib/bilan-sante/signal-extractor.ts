// lib/bilan-sante/signal-extractor.ts

import {
  DIAGNOSTIC_DIMENSIONS,
  dimensionKey,
  type DimensionId,
} from "@/lib/bilan-sante/protocol";
import type {
  BaseTrameSnapshot,
  DiagnosticSignal,
  SignalRegistry,
} from "@/lib/bilan-sante/session-model";

type ThemeKeywordMap = Record<string, string[]>;

const KEYWORDS_BY_DIMENSION: Record<DimensionId, ThemeKeywordMap> = {
  1: {
    "qualité et adéquation des équipes": [
      "équipe",
      "compétence",
      "profil",
      "niveau",
      "encadrement",
    ],
    "ressources vs charge": [
      "charge",
      "capacité",
      "ressources",
      "sous-effectif",
      "surcharge",
    ],
    "turnover absentéisme stabilité": [
      "turnover",
      "absentéisme",
      "stabilité",
      "départ",
      "fidélisation",
    ],
    "recrutement et intégration": ["recrutement", "recruter", "intégration", "onboarding"],
    "clarté des rôles": ["rôle", "responsabilité", "organigramme", "périmètre"],
  },
  2: {
    "stratégie commerciale": ["stratégie commerciale", "ciblage", "segmentation", "marché"],
    "portage managérial et déploiement réel": [
      "animation commerciale",
      "déploiement",
      "portage",
      "management commercial",
    ],
    "indicateurs funnel / taux de succès": [
      "pipeline",
      "funnel",
      "conversion",
      "taux de succès",
      "taux de transformation",
    ],
    "capacité à générer une croissance rentable": [
      "croissance",
      "rentable",
      "rentabilité commerciale",
    ],
  },
  3: {
    "construction du prix et hypothèses": ["prix", "tarif", "devis", "hypothèse", "chiffrage"],
    "délégation et arbitrage": ["arbitrage", "validation", "délégation", "escalade"],
    "fiabilité du chiffrage": ["fiabilité", "écart", "coût réel", "dérive", "chiffrage"],
    "taux de succès et critères": ["taux de succès", "critère", "go / no go", "sélection"],
    "maîtrise des écarts prix vendu / coût réel": [
      "écart",
      "coût réel",
      "prix vendu",
      "marge",
      "dérive",
    ],
  },
  4: {
    "sécurité qualité performance économique": [
      "sécurité",
      "qualité",
      "performance",
      "non-qualité",
      "incident",
    ],
    "indicateurs et rituels managériaux": ["indicateur", "rituel", "pilotage", "revue"],
    "productivité et gestion des effectifs": [
      "productivité",
      "effectif",
      "capacité",
      "charge",
      "planning",
    ],
    "pilotage cash résultat marges": ["cash", "trésorerie", "résultat", "marge"],
  },
};

function makeSignalId(
  dimensionId: DimensionId,
  theme: string,
  source: string,
  index: number
): string {
  const slug = `${theme}-${source}-${index}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);

  return `sig-d${dimensionId}-${slug}`;
}

function pickEntryAngle(theme: string, excerpt: string): DiagnosticSignal["entryAngle"] {
  const text = `${theme} ${excerpt}`.toLowerCase();

  if (
    text.includes("qui décide") ||
    text.includes("validation") ||
    text.includes("arbitrage")
  ) {
    return "arbitration";
  }

  if (
    text.includes("coût") ||
    text.includes("marge") ||
    text.includes("cash") ||
    text.includes("impact")
  ) {
    return "economics";
  }

  if (
    text.includes("procédure") ||
    text.includes("rituel") ||
    text.includes("formalis") ||
    text.includes("cadre")
  ) {
    return "formalization";
  }

  if (
    text.includes("retard") ||
    text.includes("blocage") ||
    text.includes("dépend") ||
    text.includes("clé")
  ) {
    return "dependency";
  }

  return "mechanism";
}

function buildManagerialRisk(theme: string, isAbsence: boolean): string {
  if (isAbsence) {
    return `Le thème "${theme}" apparaît non suivi ou non documenté, ce qui expose l’entreprise à un pilotage managérial insuffisamment fondé.`;
  }

  return `Le signal rattaché au thème "${theme}" suggère un risque de pilotage incomplet, de dépendance excessive ou d’arbitrage insuffisamment maîtrisé.`;
}

function buildProbableConsequence(theme: string): string {
  const lower = theme.toLowerCase();

  if (lower.includes("prix") || lower.includes("chiffrage")) {
    return "Probable dérive de marge, décisions commerciales fragiles ou perte de rentabilité.";
  }

  if (lower.includes("commercial") || lower.includes("croissance")) {
    return "Probable inefficacité commerciale, croissance non rentable ou visibilité insuffisante sur le pipeline.";
  }

  if (lower.includes("cash") || lower.includes("marge") || lower.includes("résultat")) {
    return "Probable dégradation du cash, du résultat ou de la visibilité économique.";
  }

  if (lower.includes("rôle") || lower.includes("équipe") || lower.includes("recrutement")) {
    return "Probables reprises managériales, flou de responsabilités ou fragilité d’exécution.";
  }

  return "Probable dégradation de l’exécution, de la coordination ou de la robustesse de pilotage.";
}

function scoreConfidenceFromExcerpt(excerpt: string): number {
  const len = excerpt.trim().length;
  if (len > 180) return 85;
  if (len > 120) return 75;
  if (len > 60) return 65;
  return 55;
}

function scoreCriticality(theme: string, isAbsence: boolean): number {
  const lower = theme.toLowerCase();

  if (isAbsence) return 78;
  if (lower.includes("cash") || lower.includes("marge") || lower.includes("prix")) return 90;
  if (lower.includes("rôle") || lower.includes("équipe") || lower.includes("sécurité")) return 84;
  return 72;
}

function buildExplicitSignals(snapshot: BaseTrameSnapshot): DiagnosticSignal[] {
  const signals: DiagnosticSignal[] = [];
  let runningIndex = 1;

  for (const dimension of DIAGNOSTIC_DIMENSIONS) {
    const themeMap = KEYWORDS_BY_DIMENSION[dimension.id];

    for (const [theme, keywords] of Object.entries(themeMap)) {
      for (const section of snapshot.sections) {
        const haystack = `${section.heading}\n${section.content}`.toLowerCase();

        const matchedKeyword = keywords.find((kw) => haystack.includes(kw.toLowerCase()));
        if (!matchedKeyword) continue;

        const excerpt = section.content.slice(0, 240).trim();

        signals.push({
          id: makeSignalId(dimension.id, theme, section.id, runningIndex++),
          dimensionId: dimension.id,
          theme,
          signalKind: "explicit",
          sourceType: "trame",
          sourceSectionId: section.id,
          sourceExcerpt: excerpt,
          constat: `La trame mentionne un signal exploitable sur le thème "${theme}" dans la section "${section.heading}".`,
          managerialRisk: buildManagerialRisk(theme, false),
          probableConsequence: buildProbableConsequence(theme),
          entryAngle: pickEntryAngle(theme, excerpt),
          confidenceScore: scoreConfidenceFromExcerpt(excerpt),
          criticalityScore: scoreCriticality(theme, false),
        });

        break;
      }
    }
  }

  return dedupeSignals(signals);
}

function buildAbsenceSignals(
  snapshot: BaseTrameSnapshot,
  explicitSignals: DiagnosticSignal[]
): DiagnosticSignal[] {
  const results: DiagnosticSignal[] = [];
  let runningIndex = 1;

  for (const dimension of DIAGNOSTIC_DIMENSIONS) {
    for (const theme of dimension.requiredThemes) {
      const alreadyCovered = explicitSignals.some(
        (signal) =>
          signal.dimensionId === dimension.id &&
          signal.theme.toLowerCase() === theme.toLowerCase()
      );

      const missingFieldHit = snapshot.missingFields.find(
        (field) =>
          field.dimensionId === dimension.id &&
          field.label.toLowerCase().includes(theme.split(" ")[0].toLowerCase())
      );

      if (!alreadyCovered || missingFieldHit) {
        results.push({
          id: makeSignalId(dimension.id, theme, "absence", runningIndex++),
          dimensionId: dimension.id,
          theme,
          signalKind: "absence",
          sourceType: "absence_in_trame",
          sourceSectionId: null,
          sourceExcerpt:
            missingFieldHit?.sourceText ??
            `Aucun signal suffisamment explicite trouvé dans la trame sur le thème "${theme}".`,
          constat: `Le thème "${theme}" est absent, peu documenté ou insuffisamment suivi dans la trame.`,
          managerialRisk: buildManagerialRisk(theme, true),
          probableConsequence: buildProbableConsequence(theme),
          entryAngle: "formalization",
          confidenceScore: 80,
          criticalityScore: scoreCriticality(theme, true),
        });
      }
    }
  }

  return dedupeSignals(results);
}

function dedupeSignals(signals: DiagnosticSignal[]): DiagnosticSignal[] {
  const seen = new Set<string>();
  const out: DiagnosticSignal[] = [];

  for (const signal of signals) {
    const key = [
      signal.dimensionId,
      signal.theme.toLowerCase(),
      signal.signalKind,
      signal.sourceExcerpt.toLowerCase(),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(signal);
  }

  return out;
}

export function buildSignalRegistry(snapshot: BaseTrameSnapshot): SignalRegistry {
  const explicitSignals = buildExplicitSignals(snapshot);
  const absenceSignals = buildAbsenceSignals(snapshot, explicitSignals);
  const allSignals = [...explicitSignals, ...absenceSignals].sort((a, b) => {
    if (a.dimensionId !== b.dimensionId) return a.dimensionId - b.dimensionId;
    return b.criticalityScore - a.criticalityScore;
  });
  return {
    allSignals,
    byDimension: {
      d1: allSignals.filter((s) => s.dimensionId === 1),
      d2: allSignals.filter((s) => s.dimensionId === 2),
      d3: allSignals.filter((s) => s.dimensionId === 3),
      d4: allSignals.filter((s) => s.dimensionId === 4),
  },
};

}