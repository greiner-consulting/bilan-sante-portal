// lib/bilan-sante/signal-extractor.ts

import {
  DIAGNOSTIC_DIMENSIONS,
  type DimensionId,
} from "@/lib/bilan-sante/protocol";
import type {
  BaseTrameSnapshot,
  DiagnosticSignal,
  SignalRegistry,
} from "@/lib/bilan-sante/session-model";
import {
  normalizeExtractionText,
  type LlmExtractedExplicitSignal,
  type LlmSignalExtractionResponse,
  type LlmUncoveredTheme,
} from "@/lib/bilan-sante/signal-extraction-contract";
import {
  extractSignalsForDimensionWithLlm,
  llmSignalExtractionEnabled,
} from "@/lib/bilan-sante/llm-signal-extractor";

type ThemeKeywordMap = Record<string, string[]>;
type TrameSection = BaseTrameSnapshot["sections"][number];
type MissingField = BaseTrameSnapshot["missingFields"][number];

const LOG_PREFIX = "[BilanSante][SignalExtraction]";
const MAX_EXCERPT_LENGTH = 420;
const MAX_SIGNALS_PER_THEME = 2;

function logInfo(event: string, payload?: Record<string, unknown>) {
  console.info(`${LOG_PREFIX} ${event}`, payload ?? {});
}

function logWarn(event: string, payload?: Record<string, unknown>) {
  console.warn(`${LOG_PREFIX} ${event}`, payload ?? {});
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "unknown_error");
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: unknown, max = MAX_EXCERPT_LENGTH): string {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = cleanText(value);
    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }

  return out;
}

function includesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(normalizeText(pattern)));
}

const KEYWORDS_BY_DIMENSION: Record<DimensionId, ThemeKeywordMap> = {
  1: {
    "qualité et adéquation des équipes": [
      "équipe",
      "équipes",
      "compétence",
      "profil",
      "profils",
      "technicien",
      "techniciens",
      "niveau",
      "encadrement",
      "formation",
      "expérience",
    ],
    "ressources vs charge": [
      "charge",
      "charges",
      "ressource",
      "ressources",
      "capacité",
      "capacite",
      "encadrement",
      "surdimensionné",
      "surdimensionnés",
      "30%",
      "30 %",
      "planning",
      "planification",
      "affectation",
      "volume",
    ],
    "turnover absentéisme stabilité": [
      "turnover",
      "absentéisme",
      "absenteisme",
      "stabilité",
      "stabilite",
      "départ",
      "départs",
      "démission",
      "démissions",
      "absence",
      "absences",
    ],
    "recrutement et intégration": [
      "recrutement",
      "recruter",
      "recruté",
      "recrutés",
      "intégration",
      "intégrer",
      "embauche",
      "candidat",
      "candidats",
      "cv",
      "formation",
      "onboarding",
    ],
    "clarté des rôles": [
      "rôle",
      "rôles",
      "role",
      "roles",
      "responsabilité",
      "responsabilités",
      "délégation",
      "delegation",
      "périmètre",
      "autorité",
      "qui décide",
      "décision",
    ],
  },
  2: {
    "stratégie commerciale": [
      "stratégie commerciale",
      "ciblage",
      "segmentation",
      "marché",
      "positionnement",
      "prospection",
      "offre",
    ],
    "portage managérial et déploiement réel": [
      "animation commerciale",
      "déploiement",
      "portage",
      "management commercial",
      "pilotage commercial",
      "plan d'action",
    ],
    "indicateurs funnel / taux de succès": [
      "pipeline",
      "funnel",
      "conversion",
      "taux de succès",
      "taux de transformation",
      "opportunité",
      "devis gagné",
    ],
    "capacité à générer une croissance rentable": [
      "croissance",
      "rentable",
      "rentabilité commerciale",
      "développement rentable",
      "marge commerciale",
    ],
  },
  3: {
    "construction du prix et hypothèses": [
      "prix",
      "tarif",
      "devis",
      "hypothèse",
      "hypothèses",
      "chiffrage",
      "tarification",
      "remise",
    ],
    "délégation et arbitrage": [
      "arbitrage",
      "validation",
      "délégation",
      "escalade",
      "décision",
      "autorisation",
    ],
    "fiabilité du chiffrage": [
      "fiabilité",
      "écart",
      "coût réel",
      "dérive",
      "chiffrage",
      "sous-chiffrage",
      "surcoût",
    ],
    "taux de succès et critères": [
      "taux de succès",
      "critère",
      "go / no go",
      "go/no go",
      "sélection",
      "qualification",
    ],
    "maîtrise des écarts prix vendu / coût réel": [
      "écart",
      "coût réel",
      "prix vendu",
      "marge",
      "dérive",
      "rentabilité",
    ],
  },
  4: {
    "sécurité qualité performance économique": [
      "sécurité",
      "qualité",
      "performance",
      "non-qualité",
      "incident",
      "accident",
      "conformité",
    ],
    "indicateurs et rituels managériaux": [
      "indicateur",
      "rituel",
      "pilotage",
      "revue",
      "tableau de bord",
      "kpi",
    ],
    "productivité et gestion des effectifs": [
      "productivité",
      "effectif",
      "capacité",
      "charge",
      "planning",
      "rendement",
    ],
    "pilotage cash résultat marges": [
      "cash",
      "trésorerie",
      "résultat",
      "marge",
      "rentabilité",
      "ebitda",
    ],
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
    .slice(0, 78);

  return `sig-d${dimensionId}-${slug}`;
}

function sectionId(section: TrameSection): string {
  return String(section.id ?? section.heading ?? "section").trim() || "section";
}

function sectionText(section: TrameSection): string {
  return cleanText(`${section.heading ?? ""} ${section.content ?? ""}`);
}

function scoreSectionForTheme(section: TrameSection, theme: string, keywords: string[]): number {
  const heading = normalizeText(section.heading);
  const content = normalizeText(section.content);
  const combined = `${heading} ${content}`;
  const themeNormalized = normalizeText(theme);

  let score = 0;
  if (heading.includes(themeNormalized)) score += 40;
  if (content.includes(themeNormalized)) score += 24;

  for (const keyword of keywords) {
    const key = normalizeText(keyword);
    if (!key) continue;
    if (heading.includes(key)) score += 12;
    if (content.includes(key)) score += 7;
  }

  if (content.length >= 120) score += 4;
  if (content.length >= 260) score += 4;

  if (combined.includes("commentaire") || combined.includes("observation")) score -= 5;

  return score;
}

function findBestSectionsForTheme(
  snapshot: BaseTrameSnapshot,
  theme: string,
  keywords: string[]
): Array<{ section: TrameSection; score: number }> {
  return snapshot.sections
    .map((section) => ({
      section,
      score: scoreSectionForTheme(section, theme, keywords),
    }))
    .filter((item) => item.score >= 16)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SIGNALS_PER_THEME);
}

function buildExcerpt(section: TrameSection, theme: string, keywords: string[]): string {
  const content = cleanText(section.content || section.heading || "");
  if (!content) return "";

  const lowered = content.toLowerCase();
  const anchors = [theme, ...keywords]
    .map((item) => cleanText(item))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let anchorIndex = -1;
  for (const anchor of anchors) {
    anchorIndex = lowered.indexOf(anchor.toLowerCase());
    if (anchorIndex >= 0) break;
  }

  if (anchorIndex < 0) return truncate(content);

  const start = Math.max(0, anchorIndex - 120);
  const end = Math.min(content.length, anchorIndex + 300);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return truncate(`${prefix}${content.slice(start, end).trim()}${suffix}`);
}

function pickEntryAngle(theme: string, source: string): DiagnosticSignal["entryAngle"] {
  const text = normalizeText(`${theme} ${source}`);

  if (includesAny(text, ["naval group", "responsable historique", "personne clé", "personne cle", "dépend", "depend", "relais", "absence", "départ", "démission"])) {
    return "dependency";
  }
  if (includesAny(text, ["arbitr", "qui décide", "decision", "décision", "validation", "priorité", "priorite", "affectation"])) {
    return "arbitration";
  }
  if (includesAny(text, ["marge", "cash", "résultat", "resultat", "coût", "cout", "prix", "rentabilité", "rentabilite", "volume", "facturable", "activité produite", "activite produite"])) {
    return "economics";
  }
  if (includesAny(text, ["formalis", "cadre", "rituel", "procédure", "procedure", "processus", "indicateur", "règle", "regle"])) {
    return "formalization";
  }
  if (includesAny(text, ["cause", "explique", "origine", "parce que", "manque de", "défaut", "defaut"])) {
    return "causality";
  }

  return "mechanism";
}

function hasPositiveEncadrementCapacity(text: string): boolean {
  const normalized = normalizeText(text);
  const capacitySignal = includesAny(normalized, [
    "surdimensionne",
    "surdimensionnes",
    "surstaffe",
    "surstaffes",
    "equipes d encadrement",
    "equipe d encadrement",
    "encadrement actuel",
    "avec cet encadrement",
    "absorber 30",
    "30% de charge",
    "30 % de charge",
    "30% de charges",
    "30 % de charges",
    "charges supplementaires avec cet encadrement",
    "charges supplémentaires avec cet encadrement",
  ]);

  const notEnoughVolumeSignal = includesAny(normalized, [
    "pas encore le volume",
    "volume necessaire",
    "volume nécessaire",
    "pas encore le volume necessaire",
    "pas encore le volume nécessaire",
    "soutenir la croissance mais pas encore",
  ]);

  return capacitySignal && (notEnoughVolumeSignal || normalized.includes("30"));
}

function hasNavalGroupDependency(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.includes("naval group") && includesAny(normalized, ["responsable", "historique", "cle", "clé", "dispositif"]);
}

function isLoadResourceTheme(theme: string): boolean {
  return normalizeText(theme) === normalizeText("ressources vs charge");
}

function buildLoadCapacityConstat(source: string): string {
  if (hasNavalGroupDependency(source)) {
    return "La structure dispose d’une capacité d’encadrement supérieure à la charge actuelle et estime pouvoir absorber environ 30 % de charge supplémentaire ; le point à sécuriser n’est donc pas le volume d’encadrement, mais la conversion de cette capacité en activité réellement produite et la dépendance au responsable historique Naval Group.";
  }

  return "La structure dispose d’une capacité d’encadrement supérieure à la charge actuelle et estime pouvoir absorber environ 30 % de charge supplémentaire ; le point à sécuriser n’est donc pas le volume d’encadrement, mais la transformation de cette capacité disponible en activité réellement produite et facturable.";
}

function buildLoadCapacityRisk(source: string): string {
  if (hasNavalGroupDependency(source)) {
    return "Le risque principal n’est pas un manque d’encadrement, mais la capacité à transformer cette marge d’encadrement en activité facturable et à sécuriser les relais autour du contrat Naval Group.";
  }

  return "Le risque principal n’est pas un manque d’encadrement, mais la capacité à générer le volume d’affaires, mobiliser les équipes opérationnelles et transformer cette marge de capacité en production facturable.";
}

function buildLoadCapacityConsequence(source: string): string {
  if (hasNavalGroupDependency(source)) {
    return "Capacité d’encadrement disponible mais croissance non matérialisée, avec fragilité de continuité si le relais clé Naval Group devient indisponible.";
  }

  return "Capacité d’encadrement disponible mais croissance non matérialisée, avec risque de sous-utilisation managériale et de décalage entre potentiel de charge et activité réellement produite.";
}

function inferConstatFromSource(theme: string, source: string): string {
  const text = normalizeText(source);

  if (isLoadResourceTheme(theme) && hasPositiveEncadrementCapacity(source)) {
    return buildLoadCapacityConstat(source);
  }

  if (isLoadResourceTheme(theme)) {
    if (includesAny(text, ["5 semaines", "6 mois", "prévision", "prevision", "planification"])) {
      return "Le pilotage charge / ressources fonctionne à court terme, mais la prévision au-delà de quelques semaines reste moins sécurisée.";
    }
    return "L’ajustement entre charge et ressources existe, mais il semble reposer sur des arbitrages rapprochés plus que sur un pilotage stabilisé.";
  }

  if (normalizeText(theme) === normalizeText("qualité et adéquation des équipes")) {
    if (includesAny(text, ["profil", "technicien", "recrutable", "canaux", "cv", "cible", "identification"])) {
      return "Les équipes tiennent l’activité actuelle, mais la capacité à identifier et sécuriser les bons profils reste un point sensible pour accompagner la croissance.";
    }
    return "Les équipes paraissent adaptées au niveau d’activité actuel, mais la robustesse en cas d’évolution de charge ou de besoin de compétences reste à confirmer.";
  }

  if (normalizeText(theme) === normalizeText("recrutement et intégration")) {
    if (includesAny(text, ["outils", "qualité", "qualite", "formation", "autonomie", "intégration", "integration"])) {
      return "Le recrutement et l’intégration apparaissent comme un point sensible, notamment pour rendre rapidement les nouveaux recrutés autonomes sur les outils et standards attendus.";
    }
    return "Le recrutement et l’intégration apparaissent comme un point sensible dès qu’il faut renforcer rapidement les équipes ou préparer une montée en charge.";
  }

  if (normalizeText(theme) === normalizeText("clarté des rôles")) {
    return "La répartition des rôles semble fonctionner au quotidien, mais certaines décisions ou relais de responsabilité restent à clarifier dans les situations sensibles.";
  }

  if (normalizeText(theme) === normalizeText("turnover absentéisme stabilité")) {
    return "La stabilité de fonctionnement peut être fragilisée dès que surviennent des absences, des départs ou une dépendance excessive à quelques relais.";
  }

  if (includesAny(text, ["marge", "cash", "résultat", "resultat", "rentabilité", "rentabilite", "coût", "cout", "prix"])) {
    return `Le thème "${theme}" présente un enjeu économique à objectiver pour éviter des décisions insuffisamment reliées à leur impact réel.`;
  }

  if (includesAny(text, ["arbitr", "validation", "décision", "decision", "délégation", "delegation"])) {
    return `Le thème "${theme}" fait apparaître un enjeu d’arbitrage ou de décision à clarifier dans le fonctionnement réel.`;
  }

  return `Le fonctionnement réel sur "${theme}" doit être objectivé pour apprécier sa robustesse, ses dépendances et ses limites de pilotage.`;
}

function buildManagerialRisk(theme: string, source: string, isAbsence = false): string {
  const text = normalizeText(source);

  if (isAbsence) {
    return `Le sujet "${theme}" reste insuffisamment documenté, ce qui oblige à piloter par perception plus que par repères objectivés.`;
  }

  if (isLoadResourceTheme(theme) && hasPositiveEncadrementCapacity(source)) {
    return buildLoadCapacityRisk(source);
  }

  if (isLoadResourceTheme(theme)) {
    return "L’ajustement charge / ressources peut rester dépendant d’arbitrages rapprochés, avec un risque de perte d’anticipation dès que l’activité évolue.";
  }

  if (normalizeText(theme).includes("recrutement") || normalizeText(theme).includes("équipe") || normalizeText(theme).includes("equipe")) {
    return `Le fonctionnement autour de "${theme}" tient aujourd’hui, mais sans sécurisation réelle des relais, des compétences ou de l’intégration, ce qui peut créer un décalage rapide entre les besoins et la capacité réelle.`;
  }

  if (normalizeText(theme).includes("rôle") || normalizeText(theme).includes("role")) {
    return "Le flou sur certains rôles ou relais peut générer des reprises managériales, des décisions retardées et une dilution des responsabilités.";
  }

  if (includesAny(text, ["marge", "cash", "rentabilité", "rentabilite", "prix", "coût", "cout"])) {
    return `Les décisions prises sur "${theme}" ne semblent pas toujours reliées à leur impact économique réel, ce qui expose à des écarts de marge, de coût ou de cash.`;
  }

  return `Le fonctionnement sur "${theme}" peut reposer sur des pratiques implicites ou des équilibres personnels, avec un risque de perte de maîtrise lorsque les conditions changent.`;
}

function buildProbableConsequence(theme: string, source: string): string {
  const text = normalizeText(`${theme} ${source}`);

  if (isLoadResourceTheme(theme) && hasPositiveEncadrementCapacity(source)) {
    return buildLoadCapacityConsequence(source);
  }

  if (includesAny(text, ["prix", "chiffrage", "devis", "marge", "coût", "cout"])) {
    return "Probable dérive de marge, décisions commerciales fragiles ou perte de rentabilité.";
  }

  if (includesAny(text, ["commercial", "croissance", "pipeline", "prospection", "offre"])) {
    return "Probable inefficacité commerciale, croissance non rentable ou visibilité insuffisante sur le pipeline.";
  }

  if (includesAny(text, ["cash", "trésorerie", "tresorerie", "résultat", "resultat"])) {
    return "Probable dégradation du cash, du résultat ou de la visibilité économique.";
  }

  if (includesAny(text, ["rôle", "role", "équipe", "equipe", "recrutement", "intégration", "integration"])) {
    return "Probables reprises managériales, flou de responsabilités ou fragilité d’exécution.";
  }

  return "Probable dégradation de l’exécution, de la coordination ou de la robustesse de pilotage.";
}

function scoreCriticality(theme: string, source: string, isAbsence = false): number {
  const text = normalizeText(`${theme} ${source}`);
  let score = isAbsence ? 72 : 76;

  if (isLoadResourceTheme(theme) && hasPositiveEncadrementCapacity(source)) score = 78;
  if (includesAny(text, ["naval group", "personne clé", "personne cle", "dépendance", "dependance"])) score += 8;
  if (includesAny(text, ["marge", "cash", "prix", "coût", "cout", "rentabilité", "rentabilite"])) score += 8;
  if (includesAny(text, ["sécurité", "securite", "qualité", "qualite"])) score += 4;

  return clamp(score, 55, 94);
}

function normalizeSignalSemantics(params: {
  dimensionId: DimensionId;
  theme: string;
  sourceSection: string | null;
  sourceExcerpt: string;
  signalKind: DiagnosticSignal["signalKind"];
  constat?: string | null;
  managerialRisk?: string | null;
  probableConsequence?: string | null;
  entryAngle?: DiagnosticSignal["entryAngle"] | null;
  confidenceScore?: number | null;
  criticalityScore?: number | null;
  index: number;
}): DiagnosticSignal {
  const combinedSource = cleanText(
    `${params.sourceExcerpt} ${params.constat ?? ""} ${params.managerialRisk ?? ""} ${params.probableConsequence ?? ""}`
  );
  const sourceExcerpt = normalizeExtractionText(params.sourceExcerpt) || truncate(combinedSource);

  const shouldOverridePositiveCapacity =
    params.signalKind === "explicit" &&
    isLoadResourceTheme(params.theme) &&
    hasPositiveEncadrementCapacity(combinedSource);

  const entryAngle = shouldOverridePositiveCapacity
    ? (hasNavalGroupDependency(combinedSource) ? "dependency" : "economics")
    : params.entryAngle ?? pickEntryAngle(params.theme, combinedSource);

  const constat = shouldOverridePositiveCapacity
    ? buildLoadCapacityConstat(combinedSource)
    : normalizeExtractionText(params.constat) || inferConstatFromSource(params.theme, combinedSource);

  const managerialRisk = shouldOverridePositiveCapacity
    ? buildLoadCapacityRisk(combinedSource)
    : normalizeExtractionText(params.managerialRisk) || buildManagerialRisk(params.theme, combinedSource, params.signalKind === "absence");

  const probableConsequence = shouldOverridePositiveCapacity
    ? buildLoadCapacityConsequence(combinedSource)
    : normalizeExtractionText(params.probableConsequence) || buildProbableConsequence(params.theme, combinedSource);

  return {
    id: makeSignalId(
      params.dimensionId,
      params.theme,
      `${params.sourceSection ?? params.signalKind}-${entryAngle}`,
      params.index
    ),
    dimensionId: params.dimensionId,
    theme: params.theme,
    signalKind: params.signalKind,
    sourceType: "trame",
    sourceSection: params.sourceSection,
    sourceExcerpt,
    constat,
    managerialRisk,
    probableConsequence,
    entryAngle,
    confidenceScore: clamp(params.confidenceScore ?? 72, 50, 95),
    criticalityScore: clamp(
      Math.max(params.criticalityScore ?? 0, scoreCriticality(params.theme, combinedSource, params.signalKind === "absence")),
      55,
      95
    ),
  };
}

function buildExplicitSignalsDeterministic(snapshot: BaseTrameSnapshot): DiagnosticSignal[] {
  const signals: DiagnosticSignal[] = [];
  let runningIndex = 1;

  for (const dimension of DIAGNOSTIC_DIMENSIONS) {
    const themeMap = KEYWORDS_BY_DIMENSION[dimension.id];

    for (const [theme, keywords] of Object.entries(themeMap)) {
      const bestSections = findBestSectionsForTheme(snapshot, theme, keywords);

      for (const { section, score } of bestSections) {
        const excerpt = buildExcerpt(section, theme, keywords);
        const sectionKey = sectionId(section);
        const source = `${section.heading ?? ""} ${excerpt}`;

        signals.push(
          normalizeSignalSemantics({
            dimensionId: dimension.id,
            theme,
            sourceSection: sectionKey,
            sourceExcerpt: excerpt,
            signalKind: "explicit",
            constat: inferConstatFromSource(theme, source),
            managerialRisk: buildManagerialRisk(theme, source),
            probableConsequence: buildProbableConsequence(theme, source),
            entryAngle: pickEntryAngle(theme, source),
            confidenceScore: clamp(56 + Math.round(score / 2), 55, 92),
            criticalityScore: scoreCriticality(theme, source),
            index: runningIndex++,
          })
        );
      }
    }
  }

  return dedupeSignals(signals);
}

function scoreMissingFieldHit(field: MissingField, theme: string): number {
  const haystack = normalizeText(`${field.label ?? ""} ${field.sourceText ?? ""}`);
  let score = 0;

  if (haystack.includes(normalizeText(theme))) score += 20;
  for (const token of normalizeText(theme).split(/[^a-z0-9]+/).filter((item) => item.length >= 4)) {
    if (haystack.includes(token)) score += 5;
  }

  return score;
}

function findBestMissingFieldHit(
  snapshot: BaseTrameSnapshot,
  dimensionId: DimensionId,
  theme: string
): MissingField | undefined {
  return snapshot.missingFields
    .filter((field) => field.dimensionId === dimensionId)
    .map((field) => ({ field, score: scoreMissingFieldHit(field, theme) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.field;
}

function buildAbsenceSignals(
  snapshot: BaseTrameSnapshot,
  explicitSignals: DiagnosticSignal[],
  llmUncovered = new Map<
    string,
    {
      reason: LlmUncoveredTheme["reason"];
      whyMissing: string;
      confidenceScore: number;
    }
  >()
): DiagnosticSignal[] {
  const results: DiagnosticSignal[] = [];
  let runningIndex = 1;

  for (const dimension of DIAGNOSTIC_DIMENSIONS) {
    for (const theme of dimension.requiredThemes) {
      const covered = explicitSignals.some(
        (signal) => signal.dimensionId === dimension.id && normalizeText(signal.theme) === normalizeText(theme)
      );
      if (covered) continue;

      const missingField = findBestMissingFieldHit(snapshot, dimension.id, theme);
      const llmMissing = llmUncovered.get(`${dimension.id}|${normalizeText(theme)}`);
      const sourceExcerpt =
        normalizeExtractionText(llmMissing?.whyMissing) ||
        normalizeExtractionText(missingField?.sourceText) ||
        `Aucun signal suffisamment explicite trouvé dans la trame sur le thème "${theme}".`;

      results.push(
        normalizeSignalSemantics({
          dimensionId: dimension.id,
          theme,
          sourceSection: null,
          sourceExcerpt,
          signalKind: "absence",
          constat:
            llmMissing?.reason === "not_enough_material"
              ? `Le thème "${theme}" apparaît encore trop peu documenté dans la trame pour établir un signal managérial suffisamment robuste.`
              : `Le thème "${theme}" reste insuffisamment documenté ou consolidé dans la trame.`,
          managerialRisk: buildManagerialRisk(theme, sourceExcerpt, true),
          probableConsequence: buildProbableConsequence(theme, sourceExcerpt),
          entryAngle: "formalization",
          confidenceScore: clamp(llmMissing?.confidenceScore ?? (missingField ? 82 : 76), 55, 92),
          criticalityScore: scoreCriticality(theme, sourceExcerpt, true),
          index: runningIndex++,
        })
      );
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
      normalizeText(signal.theme),
      signal.signalKind,
      String(signal.sourceSection ?? "none"),
      signal.entryAngle,
      normalizeText(signal.sourceExcerpt),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(signal);
  }

  return out;
}

function findSectionById(snapshot: BaseTrameSnapshot, sectionIdToFind: string): TrameSection | undefined {
  return snapshot.sections.find((section) => sectionId(section) === cleanText(sectionIdToFind));
}

function normalizeLlmScore(value: number | null | undefined): number {
  const safe = clamp(Number(value ?? 0), 0, 100);
  if (safe <= 5) return clamp(safe * 20, 0, 100);
  if (safe <= 10) return clamp(safe * 10, 0, 100);
  return safe;
}

function isAcceptedLlmSignal(item: LlmExtractedExplicitSignal): boolean {
  return item.evidenceNature !== "anecdotal";
}

function buildExplicitSignalsFromLlm(params: {
  snapshot: BaseTrameSnapshot;
  responses: LlmSignalExtractionResponse[];
}): DiagnosticSignal[] {
  const signals: DiagnosticSignal[] = [];
  let runningIndex = 1;

  for (const response of params.responses) {
    for (const item of response.explicitSignals) {
      if (!isAcceptedLlmSignal(item)) continue;
      const section = findSectionById(params.snapshot, item.sourceSectionId);
      if (!section) continue;

      const sectionSource = sectionText(section);
      const sourceExcerpt = normalizeExtractionText(item.sourceExcerpt) || buildExcerpt(section, item.theme, [item.theme]);
      const source = `${sectionSource} ${sourceExcerpt} ${item.constat} ${item.managerialRisk}`;

      signals.push(
        normalizeSignalSemantics({
          dimensionId: response.dimensionId,
          theme: normalizeExtractionText(item.theme) || item.theme,
          sourceSection: sectionId(section),
          sourceExcerpt,
          signalKind: "explicit",
          constat: item.constat,
          managerialRisk: item.managerialRisk,
          probableConsequence: item.probableConsequence,
          entryAngle: item.entryAngle,
          confidenceScore: normalizeLlmScore(item.confidenceScore),
          criticalityScore: normalizeLlmScore(item.criticalityScore),
          index: runningIndex++,
        })
      );
    }
  }

  return dedupeSignals(signals);
}

function buildLlmUncoveredMap(
  responses: LlmSignalExtractionResponse[]
): Map<
  string,
  {
    reason: LlmUncoveredTheme["reason"];
    whyMissing: string;
    confidenceScore: number;
  }
> {
  const out = new Map<
    string,
    {
      reason: LlmUncoveredTheme["reason"];
      whyMissing: string;
      confidenceScore: number;
    }
  >();

  for (const response of responses) {
    for (const item of response.uncoveredThemes) {
      out.set(`${response.dimensionId}|${normalizeText(item.theme)}`, {
        reason: item.reason,
        whyMissing: item.whyMissing,
        confidenceScore: normalizeLlmScore(item.confidenceScore),
      });
    }
  }

  return out;
}

function signalThemeKey(signal: DiagnosticSignal): string {
  return `${signal.dimensionId}|${normalizeText(signal.theme)}`;
}

function mergeExplicitSignalsWithDeterministicRescue(params: {
  llmSignals: DiagnosticSignal[];
  deterministicSignals: DiagnosticSignal[];
}): DiagnosticSignal[] {
  const out = [...params.llmSignals];
  const countByTheme = new Map<string, number>();

  for (const signal of out) {
    const key = signalThemeKey(signal);
    countByTheme.set(key, (countByTheme.get(key) ?? 0) + 1);
  }

  for (const signal of params.deterministicSignals) {
    const key = signalThemeKey(signal);
    const count = countByTheme.get(key) ?? 0;
    if (count >= MAX_SIGNALS_PER_THEME) continue;

    const sameSourceAlreadyPresent = out.some(
      (existing) =>
        existing.dimensionId === signal.dimensionId &&
        normalizeText(existing.theme) === normalizeText(signal.theme) &&
        normalizeText(existing.sourceExcerpt) === normalizeText(signal.sourceExcerpt)
    );
    if (sameSourceAlreadyPresent) continue;

    out.push(signal);
    countByTheme.set(key, count + 1);
  }

  return dedupeSignals(out);
}

function buildRegistryFromSignals(signals: DiagnosticSignal[]): SignalRegistry {
  const allSignals = dedupeSignals(signals).sort((a, b) => {
    if (a.dimensionId !== b.dimensionId) return a.dimensionId - b.dimensionId;
    if (a.signalKind !== b.signalKind) return a.signalKind === "explicit" ? -1 : 1;
    return b.criticalityScore - a.criticalityScore;
  });

  return {
    all: allSignals,
    allSignals,
    byDimension: {
      d1: allSignals.filter((signal) => signal.dimensionId === 1),
      d2: allSignals.filter((signal) => signal.dimensionId === 2),
      d3: allSignals.filter((signal) => signal.dimensionId === 3),
      d4: allSignals.filter((signal) => signal.dimensionId === 4),
    },
  };
}

function summarizeRegistry(registry: SignalRegistry) {
  const allSignals: DiagnosticSignal[] = registry.allSignals;
  const explicitSignals = allSignals.filter((signal) => signal.signalKind === "explicit");
  const absenceSignals = allSignals.filter((signal) => signal.signalKind === "absence");

  return {
    totalSignals: allSignals.length,
    explicitSignals: explicitSignals.length,
    absenceSignals: absenceSignals.length,
    d1: registry.byDimension.d1.length,
    d2: registry.byDimension.d2.length,
    d3: registry.byDimension.d3.length,
    d4: registry.byDimension.d4.length,
  };
}

function buildDeterministicRegistry(snapshot: BaseTrameSnapshot): SignalRegistry {
  const explicitSignals = buildExplicitSignalsDeterministic(snapshot);
  const absenceSignals = buildAbsenceSignals(snapshot, explicitSignals);
  return buildRegistryFromSignals([...explicitSignals, ...absenceSignals]);
}

export function buildSignalRegistry(snapshot: BaseTrameSnapshot): SignalRegistry {
  return buildDeterministicRegistry(snapshot);
}

export async function buildSignalRegistryWithLlm(
  snapshot: BaseTrameSnapshot
): Promise<SignalRegistry> {
  const hasOpenAiKey = llmSignalExtractionEnabled();

  logInfo("bootstrap_start", {
    hasOpenAiKey,
    sections: snapshot.sections.length,
    missingFields: snapshot.missingFields.length,
  });

  const deterministicRegistry = buildDeterministicRegistry(snapshot);

  if (!hasOpenAiKey) {
    logWarn("fallback_no_api_key", {
      hasOpenAiKey: false,
      fallbackUsed: true,
      ...summarizeRegistry(deterministicRegistry),
    });
    return deterministicRegistry;
  }

  try {
    const responses = (
      await Promise.all(
        DIAGNOSTIC_DIMENSIONS.map((dimension) =>
          extractSignalsForDimensionWithLlm({
            snapshot,
            dimensionId: dimension.id,
          })
        )
      )
    ).filter((item): item is LlmSignalExtractionResponse => item !== null);

    if (responses.length === 0) {
      logWarn("fallback_no_llm_response", {
        hasOpenAiKey: true,
        responsesReceived: 0,
        fallbackUsed: true,
        ...summarizeRegistry(deterministicRegistry),
      });
      return deterministicRegistry;
    }

    const llmSignals = buildExplicitSignalsFromLlm({ snapshot, responses });
    const explicitSignals = mergeExplicitSignalsWithDeterministicRescue({
      llmSignals,
      deterministicSignals: deterministicRegistry.allSignals.filter((signal) => signal.signalKind === "explicit"),
    });
    const uncoveredMap = buildLlmUncoveredMap(responses);
    const absenceSignals = buildAbsenceSignals(snapshot, explicitSignals, uncoveredMap);
    const registry = buildRegistryFromSignals([...explicitSignals, ...absenceSignals]);

    logInfo("llm_registry_ready", {
      hasOpenAiKey: true,
      responsesReceived: responses.length,
      explicitSignalsFromLlm: llmSignals.length,
      explicitSignalsFinal: explicitSignals.length,
      fallbackUsed: false,
      ...summarizeRegistry(registry),
    });

    return registry;
  } catch (error) {
    logWarn("fallback_exception", {
      hasOpenAiKey: true,
      error: summarizeError(error),
      fallbackUsed: true,
      ...summarizeRegistry(deterministicRegistry),
    });
    return deterministicRegistry;
  }
}
