import { dimensionTitle } from "@/lib/bilan-sante/protocol";
import {
  assertComplianceOrThrow,
  type ComplianceReport,
} from "@/lib/bilan-sante/compliance-checker";
import type {
  DiagnosticSessionAggregate,
  FinalObjective,
  FrozenDimensionDiagnosis,
  SwotItem,
  ZoneNonPilotee,
} from "@/lib/bilan-sante/session-model";

export type VisibleTableRow = {
  label: string;
  value: string;
};

export type SwotTable = {
  forces: string[];
  faiblesses: string[];
  opportunites: string[];
  risques: string[];
};

export type DimensionReportSection = {
  dimensionId: number;
  title: string;
  score: number;
  summary?: string;
  consolidatedFindings: [string, string, string];
  dominantRootCause: string;
  dominantZoneLabel?: string;
  evidenceSummary?: string[];
  unmanagedZoneTables: Array<{
    title: string;
    rows: VisibleTableRow[];
  }>;
  swot: SwotTable;
};

export type ObjectiveCard = {
  title: string;
  rows: VisibleTableRow[];
};

export type StandardDiagnosticReport = {
  title: "Bilan de Santé – Rapport Dirigeant";
  outputFormat: "docx_source_model";
  generatedAt: string;
  sectionOrder: [
    "Page d’identification",
    "Synthèse exécutive (Page 0)",
    "Historique & données d’entrée",
    "Diagnostic par dimension",
    "Synthèse transverse des zones non pilotées",
    "Plan d’actions — objectifs orientés résultats",
    "Conclusion dirigeant — enjeux, impacts, cohérence globale",
    "Confidentialité & anonymisation",
    "Checklist de conformité finale"
  ];
  identificationPage: {
    title: string;
    sessionId: string;
    generatedAt: string;
    companyLabel: string;
    dirigeantLabel: string;
    note: string;
  };
  executiveSummaryPage0: {
    title: string;
    globalScore: number;
    globalLevel: string;
    synthesis: string;
    keyStrengths: string[];
    keyVulnerabilities: string[];
    majorIssue: string;
    priorityObjectives: string[];
  };
  inputHistory: {
    title: string;
    inputRules: string[];
    trameQualityFlags: string[];
    missingFieldSignals: string[];
  };
  dimensionDiagnostics: DimensionReportSection[];
  transverseUnmanagedZones: {
    title: string;
    tables: Array<{
      title: string;
      rows: VisibleTableRow[];
    }>;
  };
  actionPlanCards: {
    title: string;
    cards: ObjectiveCard[];
  };
  leaderConclusion: {
    title: string;
    alignments: string[];
    misalignments: string[];
    contradictions: string[];
    globalImpacts: string[];
    closingStatement: string;
  };
  confidentiality: {
    title: string;
    rules: string[];
  };
  complianceChecklist: {
    title: string;
    isCompliant: boolean;
    summary: string[];
    warnings: string[];
  };
};

export type PreviewSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  tables?: Array<{
    title?: string;
    headers: string[];
    rows: string[][];
  }>;
};

export type PreviewDiagnosticReport = {
  title: string;
  generatedAt: string;
  sections: PreviewSection[];
};

type BuildReportOptions = {
  companyLabel?: string;
  dirigeantLabel?: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: string | null | undefined): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cleanSentence(value: string | null | undefined, max = 280): string {
  let text = normalizeText(value)
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:]){2,}/g, "$1")
    .replace(/\.{2,}/g, ".")
    .replace(/…+/g, "…")
    .trim();

  text = text.replace(/\s+(de|du|des|d'|et|ou|avec|pour|sur|en|par|a|à)$/i, "").trim();
  text = text.replace(/[:;,\-–—]\s*$/g, "").trim();

  if (!text) return "";
  if (text.length > max) {
    text = `${text.slice(0, max - 1).trim()}…`;
  }

  if (!/[.!?…]$/.test(text)) {
    text = `${text}.`;
  }

  return text;
}

function cleanFragment(value: string | null | undefined, max = 200): string {
  const text = cleanSentence(value, max);
  return text.replace(/[.!?…]$/, "");
}

function nonEmpty(values: Array<string | null | undefined>): string[] {
  return values.map((value) => normalizeText(value)).filter(Boolean);
}

function uniqueStrings(values: Array<string | null | undefined>, max?: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = normalizeForMatch(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (max && out.length >= max) break;
  }

  return out;
}

function truncate(value: string, max = 240): string {
  return cleanSentence(value, max);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function validationStatusLabel(value: FinalObjective["validationStatus"]): string {
  switch (value) {
    case "validated":
      return "Validé";
    case "adjusted":
      return "Ajusté";
    case "refused":
      return "Refusé";
    case "proposed":
    default:
      return "Proposé";
  }
}

function proposalSourceLabel(value: FinalObjective["proposalSource"]): string {
  switch (value) {
    case "initial_seed":
      return "Proposition issue du diagnostic consolidé";
    case "alternative_seed":
      return "Proposition alternative issue d’un autre axe du diagnostic";
    case "adjusted_feedback":
      return "Proposition ajustée à partir du retour dirigeant";
    case "fallback":
    default:
      return "Proposition de repli structurée à partir de la zone dominante";
  }
}

function weakestDimension(
  frozenDimensions: ReadonlyArray<FrozenDimensionDiagnosis>
): FrozenDimensionDiagnosis | null {
  if (frozenDimensions.length === 0) return null;
  return [...frozenDimensions].sort((a, b) => a.score - b.score)[0] ?? null;
}

function strongestDimension(
  frozenDimensions: ReadonlyArray<FrozenDimensionDiagnosis>
): FrozenDimensionDiagnosis | null {
  if (frozenDimensions.length === 0) return null;
  return [...frozenDimensions].sort((a, b) => b.score - a.score)[0] ?? null;
}

function averageScore(frozenDimensions: ReadonlyArray<FrozenDimensionDiagnosis>): number {
  if (frozenDimensions.length === 0) return 1;

  const avg =
    frozenDimensions.reduce((sum, dimension) => sum + dimension.score, 0) /
    frozenDimensions.length;

  return Number(avg.toFixed(1));
}

function globalLevelFromAverage(score: number): string {
  if (score < 2.5) return "Fragile";
  if (score < 3.8) return "Intermédiaire";
  return "Solide";
}

function getFrozenDimensions(
  session: Pick<DiagnosticSessionAggregate, "frozenDimensions">
): FrozenDimensionDiagnosis[] {
  return Array.isArray(session.frozenDimensions) ? session.frozenDimensions : [];
}

function getFinalObjectives(
  session: Pick<DiagnosticSessionAggregate, "finalObjectives">
): FinalObjective[] {
  return Array.isArray(session.finalObjectives?.objectives)
    ? session.finalObjectives.objectives
    : [];
}

function isWeaknessLike(text: string): boolean {
  const normalized = normalizeForMatch(text);
  if (!normalized) return false;

  return [
    "fragil",
    "insuff",
    "absence",
    "non pilote",
    "non pilot",
    "non suivi",
    "non document",
    "manque",
    "derive",
    "deterior",
    "degradation",
    "ecart",
    "risque",
    "depend",
    "blocage",
    "tension",
    "faible",
    "defaut",
  ].some((token) => normalized.includes(token));
}

function swotLabels(items: SwotItem[] | undefined, max = 3): string[] {
  if (!Array.isArray(items)) return [];
  return uniqueStrings(
    items.flatMap((item) => [item.label, item.detail, item.rationale]).map((x) => cleanFragment(x, 170)),
    max
  );
}

function dominantZone(frozen: FrozenDimensionDiagnosis): ZoneNonPilotee | null {
  return frozen.unmanagedZones?.[0] ?? frozen.nonPilotedAreas?.[0] ?? null;
}

function dominantZoneLabel(frozen: FrozenDimensionDiagnosis): string {
  const zone = dominantZone(frozen);
  if (!zone) return "Zone dominante non renseignée";
  return cleanFragment(zone.constat, 110) || "Zone dominante non renseignée";
}

function findFrozenByDimension(
  frozenDimensions: ReadonlyArray<FrozenDimensionDiagnosis>,
  dimensionId: number
): FrozenDimensionDiagnosis | null {
  return frozenDimensions.find((item) => Number(item.dimensionId) === Number(dimensionId)) ?? null;
}

function objectiveDiagnosticAnchor(frozen: FrozenDimensionDiagnosis | null): string {
  if (!frozen) {
    return "Ancrage diagnostique non disponible.";
  }

  const zone = dominantZone(frozen);
  const parts = [
    zone ? `Zone prioritaire : ${cleanFragment(zone.constat, 140)}` : "",
    frozen.dominantRootCause ? `Cause dominante : ${cleanFragment(frozen.dominantRootCause, 150)}` : "",
  ].filter(Boolean);

  if (parts.length === 0) {
    return `Dimension ${dimensionTitle(frozen.dimensionId)} — ancrage diagnostique non disponible.`;
  }

  return cleanSentence(parts.join(". "), 320);
}

function supportStatementsForDimension(frozen: FrozenDimensionDiagnosis): string[] {
  const fromSnapshot = swotLabels(frozen.swot?.strengths, 3);
  if (fromSnapshot.length > 0) return fromSnapshot;

  const fromEvidence = uniqueStrings(
    (frozen.evidenceSummary ?? []).filter((item) => !isWeaknessLike(item)).map((item) => cleanFragment(item, 160)),
    3
  );
  if (fromEvidence.length > 0) return fromEvidence;

  if (frozen.score >= 4) {
    const safeFindings = uniqueStrings(
      frozen.consolidatedFindings.filter((item) => !isWeaknessLike(item)).map((item) => cleanFragment(item, 170)),
      2
    );
    if (safeFindings.length > 0) {
      return safeFindings.map((item) => `Point d’appui déjà en place : ${item}`);
    }
  }

  return [];
}

function vulnerabilityStatementsForDimension(frozen: FrozenDimensionDiagnosis): string[] {
  const zone = dominantZone(frozen);

  return uniqueStrings(
    [
      zone?.risqueManagerial,
      zone?.constat,
      zone?.consequence,
      frozen.dominantRootCause,
    ].map((item) => cleanFragment(item, 170)),
    4
  );
}

function buildExecutiveSynthesis(session: DiagnosticSessionAggregate) {
  const frozenDimensions = getFrozenDimensions(session);
  const avg = averageScore(frozenDimensions);
  const weakest = weakestDimension(frozenDimensions);
  const strongest = strongestDimension(frozenDimensions);

  const strengths = uniqueStrings(
    frozenDimensions.flatMap((frozen) =>
      supportStatementsForDimension(frozen).map(
        (item) => `${dimensionTitle(frozen.dimensionId)} — ${cleanFragment(item, 160)}`
      )
    ),
    3
  );

  const vulnerabilities = uniqueStrings(
    frozenDimensions
      .slice()
      .sort((a, b) => a.score - b.score)
      .flatMap((frozen) =>
        vulnerabilityStatementsForDimension(frozen).map(
          (item) => `${dimensionTitle(frozen.dimensionId)} — ${cleanFragment(item, 165)}`
        )
      ),
    4
  );

  const objectiveLabels = getFinalObjectives(session)
    .slice(0, 5)
    .map((objective) => cleanFragment(objective.objectiveLabel, 170));

  const synthesis = weakest
    ? cleanSentence(
        [
          `Le diagnostic 4D fait ressortir un niveau global ${globalLevelFromAverage(avg).toLowerCase()}, avec un score moyen de ${avg}/5.`,
          `La zone de fragilité prioritaire se situe sur la dimension "${dimensionTitle(weakest.dimensionId)}".`,
          `La lecture consolidée y fait apparaître ${cleanFragment(weakest.dominantRootCause, 150)}.`,
          strongest
            ? `Le principal point d’appui disponible se situe sur "${dimensionTitle(strongest.dimensionId)}", qui peut servir de base pour sécuriser la mise en mouvement du plan d’actions.`
            : "",
        ].join(" "),
        540
      )
    : "Le diagnostic 4D a été consolidé, mais aucune dimension gelée n’est disponible.";

  return {
    globalScore: avg,
    globalLevel: globalLevelFromAverage(avg),
    synthesis,
    keyStrengths:
      strengths.length > 0
        ? strengths
        : ["Aucun point d’appui suffisamment consolidé à ce stade."],
    keyVulnerabilities:
      vulnerabilities.length > 0
        ? vulnerabilities
        : ["Aucune vulnérabilité suffisamment consolidée à ce stade."],
    majorIssue: weakest
      ? cleanSentence(`${dimensionTitle(weakest.dimensionId)} — cause racine dominante : ${weakest.dominantRootCause}`, 220)
      : "Enjeu majeur non disponible.",
    priorityObjectives:
      objectiveLabels.length > 0
        ? objectiveLabels
        : ["Aucun objectif final disponible."],
  };
}

function toZoneTable(zone: ZoneNonPilotee, title: string) {
  return {
    title,
    rows: [
      { label: "Constat", value: cleanSentence(zone.constat, 240) },
      { label: "Risque managérial", value: cleanSentence(zone.risqueManagerial, 220) },
      { label: "Conséquence", value: cleanSentence(zone.consequence, 220) },
    ],
  };
}

function buildSwot(frozen: FrozenDimensionDiagnosis): SwotTable {
  const forces = uniqueStrings(
    [
      ...supportStatementsForDimension(frozen),
      ...(frozen.swot?.strengths ?? []).map((item) => cleanFragment(item.label, 160)),
    ],
    4
  );

  const faiblesses = uniqueStrings(
    [
      ...(frozen.unmanagedZones ?? []).map((zone) => cleanFragment(zone.constat, 170)),
      ...(frozen.swot?.weaknesses ?? []).map((item) => cleanFragment(item.label, 170)),
      cleanFragment(frozen.dominantRootCause, 170),
    ],
    4
  );

  const opportunites = uniqueStrings(
    [
      ...(frozen.objectiveSeeds ?? []).map((seed) => cleanFragment(seed.label, 170)),
      ...(frozen.objectiveSeeds ?? []).map((seed) => cleanFragment(seed.quickWin, 170)),
      `Réduction directe de l’exposition liée à la cause racine : ${cleanFragment(frozen.dominantRootCause, 150)}`,
      `Amélioration de la robustesse de pilotage sur la dimension "${dimensionTitle(
        frozen.dimensionId
      )}"`,
    ],
    4
  );

  const risques = uniqueStrings(
    [
      ...(frozen.unmanagedZones ?? []).map((zone) => cleanFragment(zone.consequence, 170)),
      ...(frozen.swot?.threats ?? []).map((item) => cleanFragment(item.label, 170)),
      ...(frozen.unmanagedZones ?? []).map((zone) => cleanFragment(zone.risqueManagerial, 170)),
    ],
    4
  );

  return {
    forces:
      forces.length > 0 ? forces : ["Aucun point d’appui assez robuste pour être classé en force à ce stade."],
    faiblesses: faiblesses.length > 0 ? faiblesses : ["Aucune faiblesse consolidée non renseignée."],
    opportunites:
      opportunites.length > 0
        ? opportunites
        : ["Aucune opportunité structurée n’a encore été formalisée."],
    risques: risques.length > 0 ? risques : ["Aucun risque consolidé non renseigné."],
  };
}

function buildDimensionSection(
  frozen: FrozenDimensionDiagnosis
): DimensionReportSection {
  return {
    dimensionId: frozen.dimensionId,
    title: dimensionTitle(frozen.dimensionId),
    score: frozen.score,
    summary: cleanSentence(frozen.summary, 420),
    consolidatedFindings: [
      cleanSentence(frozen.consolidatedFindings[0], 240),
      cleanSentence(frozen.consolidatedFindings[1], 240),
      cleanSentence(frozen.consolidatedFindings[2], 240),
    ],
    dominantRootCause: cleanSentence(frozen.dominantRootCause, 220),
    dominantZoneLabel: dominantZoneLabel(frozen),
    evidenceSummary: uniqueStrings((frozen.evidenceSummary ?? []).map((item) => cleanSentence(item, 180)), 4),
    unmanagedZoneTables: (frozen.unmanagedZones ?? []).map((zone, index) =>
      toZoneTable(zone, `Zone non pilotée ${index + 1}`)
    ),
    swot: buildSwot(frozen),
  };
}

function buildTransverseZones(session: DiagnosticSessionAggregate) {
  const frozenDimensions = getFrozenDimensions(session);

  const tables = frozenDimensions.flatMap((frozen) =>
    (frozen.unmanagedZones ?? []).slice(0, 1).map((zone) =>
      toZoneTable(zone, `${dimensionTitle(frozen.dimensionId)} — zone dominante`)
    )
  );

  return {
    title: "Synthèse transverse des zones non pilotées",
    tables,
  };
}

function objectiveCard(
  objective: FinalObjective,
  frozenDimensions: ReadonlyArray<FrozenDimensionDiagnosis>
): ObjectiveCard {
  const frozen = findFrozenByDimension(frozenDimensions, Number(objective.dimensionId));
  const zone = frozen ? dominantZoneLabel(frozen) : "Zone non disponible";
  const cause = frozen ? cleanSentence(frozen.dominantRootCause, 190) : "Cause dominante non disponible";
  const evidence = frozen
    ? uniqueStrings((frozen.evidenceSummary ?? []).map((item) => cleanSentence(item, 150)), 3).join(" | ")
    : "";

  return {
    title: `Carte objectif — ${dimensionTitle(objective.dimensionId)}`,
    rows: [
      { label: "Objectif de résultat", value: cleanSentence(objective.objectiveLabel, 240) },
      { label: "Responsable", value: objective.owner },
      { label: "Ancrage diagnostic", value: objectiveDiagnosticAnchor(frozen) },
      { label: "Zone prioritaire visée", value: zone },
      { label: "Cause dominante visée", value: cause },
      evidence ? { label: "Éléments d’appui", value: evidence } : null,
      { label: "Indicateur clé", value: cleanSentence(objective.keyIndicator, 220) },
      { label: "Échéance", value: objective.dueDate },
      {
        label: "Gain potentiel",
        value: cleanSentence(objective.potentialGain, 220),
      },
      {
        label: "Hypothèses de gain",
        value: uniqueStrings(objective.gainHypotheses.map((item) => cleanSentence(item, 170)), 4).join(" | "),
      },
      { label: "Origine de la proposition", value: proposalSourceLabel(objective.proposalSource) },
      { label: "Statut validation dirigeant", value: validationStatusLabel(objective.validationStatus) },
      { label: "Quick win", value: cleanSentence(objective.quickWin, 200) },
    ].filter(Boolean) as VisibleTableRow[],
  };
}

function buildActionPlanCards(session: DiagnosticSessionAggregate) {
  const frozenDimensions = getFrozenDimensions(session);
  return {
    title: "Plan d’actions — objectifs orientés résultats",
    cards: getFinalObjectives(session).map((objective) =>
      objectiveCard(objective, frozenDimensions)
    ),
  };
}

function buildLeaderConclusion(session: DiagnosticSessionAggregate) {
  const frozenDimensions = getFrozenDimensions(session);
  const weakest = weakestDimension(frozenDimensions);
  const strongest = strongestDimension(frozenDimensions);

  const alignments: string[] = [];
  const misalignments: string[] = [];
  const contradictions: string[] = [];
  const globalImpacts: string[] = [];

  if (strongest) {
    alignments.push(
      cleanSentence(
        `La dimension la plus robuste semble être "${dimensionTitle(
          strongest.dimensionId
        )}", ce qui peut servir d’appui pour sécuriser la mise en mouvement du plan d’actions.`,
        220
      )
    );
  }

  if (weakest) {
    misalignments.push(
      cleanSentence(
        `La dimension "${dimensionTitle(
          weakest.dimensionId
        )}" concentre l’écart principal entre fonctionnement attendu et fonctionnement observé.`,
        220
      )
    );
    const zone = dominantZone(weakest);
    if (zone) {
      misalignments.push(
        cleanSentence(
          `La zone dominante sur cette dimension se résume ainsi : ${cleanFragment(zone.constat, 180)}.`,
          240
        )
      );
      misalignments.push(
        cleanSentence(
          `Le risque managérial prioritaire qui en découle est : ${cleanFragment(zone.risqueManagerial, 180)}.`,
          240
        )
      );
    }
  }

  if (
    frozenDimensions.some((d) => d.dimensionId === 2) &&
    frozenDimensions.some((d) => d.dimensionId === 3)
  ) {
    contradictions.push(
      cleanSentence(
        "Une tension potentielle existe entre ambition commerciale, discipline de sélection des affaires et robustesse de la marge réellement tenue.",
        220
      )
    );
  }

  if (
    frozenDimensions.some((d) => d.dimensionId === 1) &&
    frozenDimensions.some((d) => d.dimensionId === 4)
  ) {
    contradictions.push(
      cleanSentence(
        "Une faiblesse de rôles, relais ou capacités peut amplifier directement les dérives d’exécution, de qualité ou de productivité.",
        220
      )
    );
  }

  globalImpacts.push(
    cleanSentence(
      "Les causes racines identifiées montrent que la performance économique ne dépend pas d’un seul sujet, mais d’un enchaînement entre pilotage, arbitrage, sélectivité et discipline d’exécution.",
      250
    )
  );
  globalImpacts.push(
    cleanSentence(
      "Le plan d’actions doit être lu comme la traduction structurée du diagnostic gelé, avec un objectif par dimension directement relié à la zone dominante et à la cause racine associée.",
      240
    )
  );

  return {
    title: "Conclusion dirigeant — enjeux, impacts, cohérence globale",
    alignments,
    misalignments,
    contradictions,
    globalImpacts,
    closingStatement: cleanSentence(
      "La cohérence globale du diagnostic repose sur la capacité du dirigeant à traiter en parallèle les dimensions les plus exposées, sans rouvrir le diagnostic gelé, mais en transformant ses constats en objectifs de résultat réellement pilotables et explicitement ancrés dans les zones non maîtrisées.",
      340
    ),
  };
}

function buildConfidentialitySection() {
  return {
    title: "Confidentialité & anonymisation",
    rules: [
      "Aucun nom d’entreprise, de personne ou de localisation issue du corpus interne n’est reproduit.",
      "Toute référence au corpus interne reste générique et anonymisée.",
      "Le document Word constitue la version de référence remise au dirigeant.",
    ],
  };
}

function buildInputHistory(session: DiagnosticSessionAggregate) {
  return {
    title: "Historique & données d’entrée",
    inputRules: [
      "Le diagnostic ne démarre qu’après réception de la trame de base.",
      "Toute donnée absente est traitée comme un signal de maturité managériale et de risque de pilotage.",
      "Aucun chiffre précis n’est inventé ; les gains sont exprimés en fourchettes prudentes avec hypothèses.",
    ],
    trameQualityFlags:
      session.trame?.qualityFlags.map((flag) => cleanSentence(`[${flag.severity}] ${flag.message}`, 220)) ?? [],
    missingFieldSignals:
      session.trame?.missingFields.map(
        (field) =>
          cleanSentence(
            `${field.label} — ${field.sourceText}${
              field.dimensionId ? ` (dimension ${field.dimensionId})` : ""
            }`,
            220
          )
      ) ?? [],
  };
}

function buildIdentificationPage(
  session: DiagnosticSessionAggregate,
  options?: BuildReportOptions
) {
  return {
    title: "Page d’identification",
    sessionId: session.sessionId,
    generatedAt: new Date().toISOString(),
    companyLabel: options?.companyLabel ?? "Entreprise analysée (anonymisée)",
    dirigeantLabel: options?.dirigeantLabel ?? "Dirigeant (anonymisé)",
    note:
      "Ce document constitue le livrable de référence du Diagnostic 4D. Il restitue uniquement de la matière issue de la trame, des échanges de diagnostic, des consolidations gelées et de l’itération finale objectifs.",
  };
}

function buildChecklist(compliance: ComplianceReport) {
  return {
    title: "Checklist de conformité finale",
    isCompliant: compliance.isCompliant,
    summary: compliance.summary.map((item) => cleanSentence(item, 200)),
    warnings: compliance.warnings.map(
      (issue) => cleanSentence(`[${issue.code}] ${issue.message}`, 220)
    ),
  };
}

export function buildStandardDiagnosticReport(
  session: DiagnosticSessionAggregate,
  options?: BuildReportOptions
): StandardDiagnosticReport {
  const compliance = assertComplianceOrThrow(session);
  const executive = buildExecutiveSynthesis(session);
  const frozenDimensions = getFrozenDimensions(session);

  return {
    title: "Bilan de Santé – Rapport Dirigeant",
    outputFormat: "docx_source_model",
    generatedAt: new Date().toISOString(),
    sectionOrder: [
      "Page d’identification",
      "Synthèse exécutive (Page 0)",
      "Historique & données d’entrée",
      "Diagnostic par dimension",
      "Synthèse transverse des zones non pilotées",
      "Plan d’actions — objectifs orientés résultats",
      "Conclusion dirigeant — enjeux, impacts, cohérence globale",
      "Confidentialité & anonymisation",
      "Checklist de conformité finale",
    ],
    identificationPage: buildIdentificationPage(session, options),
    executiveSummaryPage0: {
      title: "Synthèse exécutive (Page 0)",
      globalScore: executive.globalScore,
      globalLevel: executive.globalLevel,
      synthesis: executive.synthesis,
      keyStrengths: executive.keyStrengths,
      keyVulnerabilities: executive.keyVulnerabilities,
      majorIssue: executive.majorIssue,
      priorityObjectives: executive.priorityObjectives,
    },
    inputHistory: buildInputHistory(session),
    dimensionDiagnostics: [...frozenDimensions]
      .sort((a, b) => a.dimensionId - b.dimensionId)
      .map(buildDimensionSection),
    transverseUnmanagedZones: buildTransverseZones(session),
    actionPlanCards: buildActionPlanCards(session),
    leaderConclusion: buildLeaderConclusion(session),
    confidentiality: buildConfidentialitySection(),
    complianceChecklist: buildChecklist(compliance),
  };
}

function zoneRowsToPreviewTable(zoneTables: Array<{ title: string; rows: VisibleTableRow[] }>) {
  return zoneTables.map((table) => ({
    title: table.title,
    headers: ["Champ", "Contenu"],
    rows: table.rows.map((row) => [row.label, row.value]),
  }));
}

function swotToPreviewTable(swot: SwotTable) {
  return {
    headers: ["Points d’appui", "Faiblesses", "Opportunités", "Risques"],
    rows: Array.from({
      length: Math.max(swot.forces.length, swot.faiblesses.length, swot.opportunites.length, swot.risques.length),
    }).map((_, index) => [
      swot.forces[index] ?? "",
      swot.faiblesses[index] ?? "",
      swot.opportunites[index] ?? "",
      swot.risques[index] ?? "",
    ]),
  };
}

function constatsToPreviewTable(items: [string, string, string]) {
  return {
    title: "Constats consolidés",
    headers: ["#", "Constat"],
    rows: items.map((item, index) => [`${index + 1}`, item]),
  };
}

function objectiveSummaryTable(cards: ObjectiveCard[]) {
  return {
    title: "Synthèse des objectifs de résultat",
    headers: ["Dimension", "Objectif de résultat", "Zone visée", "Indicateur", "Échéance", "Statut"],
    rows: cards.map((card) => {
      const byLabel = new Map(card.rows.map((row) => [row.label, row.value]));
      return [
        card.title.replace(/^Carte objectif\s+—\s+/, ""),
        byLabel.get("Objectif de résultat") ?? "",
        byLabel.get("Zone prioritaire visée") ?? "",
        byLabel.get("Indicateur clé") ?? "",
        byLabel.get("Échéance") ?? "",
        byLabel.get("Statut validation dirigeant") ?? "",
      ];
    }),
  };
}

export function buildPreviewDiagnosticReport(report: StandardDiagnosticReport): PreviewDiagnosticReport {
  const sections: PreviewSection[] = [];

  sections.push({
    id: "identification",
    title: "1. Page d’identification",
    paragraphs: [report.identificationPage.note],
    tables: [
      {
        headers: ["Champ", "Valeur"],
        rows: [
          ["Entreprise", report.identificationPage.companyLabel],
          ["Dirigeant", report.identificationPage.dirigeantLabel],
          ["Date de génération", report.identificationPage.generatedAt],
          ["Session", report.identificationPage.sessionId],
        ],
      },
    ],
  });

  sections.push({
    id: "executive-summary",
    title: "2. Synthèse exécutive (Page 0)",
    paragraphs: [report.executiveSummaryPage0.synthesis],
    bullets: [
      `Score global : ${report.executiveSummaryPage0.globalScore}/5`,
      `Niveau global : ${report.executiveSummaryPage0.globalLevel}`,
      `Enjeu majeur : ${report.executiveSummaryPage0.majorIssue}`,
    ],
    tables: [
      {
        title: "Lecture dirigeant",
        headers: ["Points d’appui consolidés", "Vulnérabilités prioritaires"],
        rows: Array.from({
          length: Math.max(
            report.executiveSummaryPage0.keyStrengths.length,
            report.executiveSummaryPage0.keyVulnerabilities.length
          ),
        }).map((_, index) => [
          report.executiveSummaryPage0.keyStrengths[index] ?? "",
          report.executiveSummaryPage0.keyVulnerabilities[index] ?? "",
        ]),
      },
      {
        title: "Objectifs structurants proposés",
        headers: ["Objectif"],
        rows: report.executiveSummaryPage0.priorityObjectives.map((item) => [item]),
      },
    ],
  });

  sections.push({
    id: "input-history",
    title: "3. Historique & données d’entrée",
    bullets: report.inputHistory.inputRules,
    tables: [
      {
        title: "Qualité de trame",
        headers: ["Flags qualité", "Champs non suivis / absents"],
        rows: Array.from({
          length: Math.max(
            report.inputHistory.trameQualityFlags.length || 1,
            report.inputHistory.missingFieldSignals.length || 1
          ),
        }).map((_, index) => [
          report.inputHistory.trameQualityFlags[index] ?? "",
          report.inputHistory.missingFieldSignals[index] ?? "",
        ]),
      },
    ],
  });

  for (const dimension of report.dimensionDiagnostics) {
    sections.push({
      id: `dimension-${dimension.dimensionId}`,
      title: `4.${dimension.dimensionId} ${dimension.title}`,
      paragraphs: nonEmpty([
        dimension.summary,
        dimension.dominantZoneLabel ? `Zone dominante : ${dimension.dominantZoneLabel}` : "",
      ]),
      bullets: [
        `Score : ${dimension.score}/5`,
        `Cause racine dominante : ${dimension.dominantRootCause}`,
      ],
      tables: [
        constatsToPreviewTable(dimension.consolidatedFindings),
        ...(dimension.evidenceSummary && dimension.evidenceSummary.length > 0
          ? [{
              title: "Éléments de matière consolidés",
              headers: ["Élément"],
              rows: dimension.evidenceSummary.map((item) => [item]),
            }]
          : []),
        ...zoneRowsToPreviewTable(dimension.unmanagedZoneTables),
        {
          title: "SWOT",
          headers: swotToPreviewTable(dimension.swot).headers,
          rows: swotToPreviewTable(dimension.swot).rows,
        },
      ],
    });
  }

  sections.push({
    id: "transverse-zones",
    title: "5. Synthèse transverse des zones non pilotées",
    tables: report.transverseUnmanagedZones.tables.map((table) => ({
      title: table.title,
      headers: ["Champ", "Contenu"],
      rows: table.rows.map((row) => [row.label, row.value]),
    })),
  });

  sections.push({
    id: "action-plan",
    title: "6. Plan d’actions — objectifs orientés résultats",
    paragraphs: [
      "Chaque objectif reprend une zone dominante déjà gelée dans le diagnostic. Il ne s’agit pas d’une recommandation libre, mais d’une traduction opérationnelle d’un risque et d’une cause explicitement documentés.",
    ],
    tables: [
      objectiveSummaryTable(report.actionPlanCards.cards),
      ...report.actionPlanCards.cards.map((card) => ({
        title: card.title,
        headers: ["Champ", "Contenu"],
        rows: card.rows.map((row) => [row.label, row.value]),
      })),
    ],
  });

  sections.push({
    id: "leader-conclusion",
    title: "7. Conclusion dirigeant — enjeux, impacts, cohérence globale",
    paragraphs: [report.leaderConclusion.closingStatement],
    tables: [
      {
        title: "Lecture transverse",
        headers: ["Alignements", "Désalignements", "Contradictions", "Impacts globaux"],
        rows: Array.from({
          length: Math.max(
            report.leaderConclusion.alignments.length || 1,
            report.leaderConclusion.misalignments.length || 1,
            report.leaderConclusion.contradictions.length || 1,
            report.leaderConclusion.globalImpacts.length || 1
          ),
        }).map((_, index) => [
          report.leaderConclusion.alignments[index] ?? "",
          report.leaderConclusion.misalignments[index] ?? "",
          report.leaderConclusion.contradictions[index] ?? "",
          report.leaderConclusion.globalImpacts[index] ?? "",
        ]),
      },
    ],
  });

  sections.push({
    id: "confidentiality",
    title: "8. Confidentialité & anonymisation",
    bullets: report.confidentiality.rules,
  });

  sections.push({
    id: "compliance",
    title: "9. Checklist de conformité finale",
    bullets: [
      `Conforme : ${report.complianceChecklist.isCompliant ? "oui" : "non"}`,
      ...report.complianceChecklist.summary,
      ...report.complianceChecklist.warnings,
    ],
  });

  return {
    title: report.title,
    generatedAt: report.generatedAt,
    sections,
  };
}

export function buildPlainTextDiagnosticReport(report: StandardDiagnosticReport): string {
  const lines: string[] = [];
  const push = (value = "") => lines.push(value);

  push(report.title);
  push("");
  push("1. Page d’identification");
  push(`Entreprise : ${report.identificationPage.companyLabel}`);
  push(`Dirigeant : ${report.identificationPage.dirigeantLabel}`);
  push(`Date : ${report.identificationPage.generatedAt}`);
  push(`Session : ${report.identificationPage.sessionId}`);
  push(report.identificationPage.note);
  push("");

  push("2. Synthèse exécutive (Page 0)");
  push(report.executiveSummaryPage0.synthesis);
  push(`Score global : ${report.executiveSummaryPage0.globalScore}/5`);
  push(`Niveau global : ${report.executiveSummaryPage0.globalLevel}`);
  push(`Enjeu majeur : ${report.executiveSummaryPage0.majorIssue}`);
  push("Points d’appui consolidés :");
  report.executiveSummaryPage0.keyStrengths.forEach((item) => push(`- ${item}`));
  push("Vulnérabilités / expositions :");
  report.executiveSummaryPage0.keyVulnerabilities.forEach((item) => push(`- ${item}`));
  push("Objectifs structurants :");
  report.executiveSummaryPage0.priorityObjectives.forEach((item) => push(`- ${item}`));
  push("");

  push("3. Historique & données d’entrée");
  report.inputHistory.inputRules.forEach((item) => push(`- ${item}`));
  if (report.inputHistory.trameQualityFlags.length > 0) {
    push("Flags qualité de trame :");
    report.inputHistory.trameQualityFlags.forEach((item) => push(`- ${item}`));
  }
  if (report.inputHistory.missingFieldSignals.length > 0) {
    push("Champs non suivis / non formalisés :");
    report.inputHistory.missingFieldSignals.forEach((item) => push(`- ${item}`));
  }
  push("");

  push("4. Diagnostic par dimension");
  for (const dimension of report.dimensionDiagnostics) {
    push(`${dimension.title} — score ${dimension.score}/5`);
    if (dimension.summary) push(dimension.summary);
    push("Constats consolidés :");
    dimension.consolidatedFindings.forEach((item) => push(`- ${item}`));
    push(`Cause racine dominante : ${dimension.dominantRootCause}`);
    if (dimension.evidenceSummary?.length) {
      push("Éléments de matière consolidés :");
      dimension.evidenceSummary.forEach((item) => push(`- ${item}`));
    }
    push("Zones non pilotées / non formalisées :");
    for (const table of dimension.unmanagedZoneTables) {
      push(`${table.title}`);
      table.rows.forEach((row) => push(`- ${row.label} : ${row.value}`));
    }
    push("SWOT :");
    dimension.swot.forces.forEach((item) => push(`- Point d’appui : ${item}`));
    dimension.swot.faiblesses.forEach((item) => push(`- Faiblesse : ${item}`));
    dimension.swot.opportunites.forEach((item) => push(`- Opportunité : ${item}`));
    dimension.swot.risques.forEach((item) => push(`- Risque : ${item}`));
    push("");
  }

  push("5. Synthèse transverse des zones non pilotées");
  for (const table of report.transverseUnmanagedZones.tables) {
    push(table.title);
    table.rows.forEach((row) => push(`- ${row.label} : ${row.value}`));
  }
  push("");

  push("6. Plan d’actions — objectifs orientés résultats");
  push("Chaque objectif reprend une zone dominante et une cause racine explicitement documentées.");
  for (const card of report.actionPlanCards.cards) {
    push(card.title);
    card.rows.forEach((row) => push(`- ${row.label} : ${row.value}`));
    push("");
  }

  push("7. Conclusion dirigeant — enjeux, impacts, cohérence globale");
  report.leaderConclusion.alignments.forEach((item) => push(`- Alignement : ${item}`));
  report.leaderConclusion.misalignments.forEach((item) => push(`- Désalignement : ${item}`));
  report.leaderConclusion.contradictions.forEach((item) => push(`- Contradiction : ${item}`));
  report.leaderConclusion.globalImpacts.forEach((item) => push(`- Impact global : ${item}`));
  push(report.leaderConclusion.closingStatement);
  push("");

  push("8. Confidentialité & anonymisation");
  report.confidentiality.rules.forEach((item) => push(`- ${item}`));
  push("");

  push("9. Checklist de conformité finale");
  push(`Conforme : ${report.complianceChecklist.isCompliant ? "oui" : "non"}`);
  report.complianceChecklist.summary.forEach((item) => push(`- ${item}`));
  report.complianceChecklist.warnings.forEach((item) => push(`- ${item}`));

  return lines.join("\n");
}

export function buildHtmlDiagnosticReport(report: StandardDiagnosticReport): string {
  const preview = buildPreviewDiagnosticReport(report);

  const sectionHtml = preview.sections
    .map((section) => {
      const paragraphs = nonEmpty(section.paragraphs ?? []).map((item) => `<p>${escapeXml(item)}</p>`).join("");
      const bullets = nonEmpty(section.bullets ?? []).length > 0
        ? `<ul>${nonEmpty(section.bullets ?? []).map((item) => `<li>${escapeXml(item)}</li>`).join("")}</ul>`
        : "";
      const tables = (section.tables ?? [])
        .map((table) => `
          <div class="table-block">
            ${table.title ? `<div class="table-title">${escapeXml(table.title)}</div>` : ""}
            <table>
              <thead>
                <tr>${table.headers.map((header) => `<th>${escapeXml(header)}</th>`).join("")}</tr>
              </thead>
              <tbody>
                ${table.rows
                  .map(
                    (row) => `<tr>${row.map((cell) => `<td>${escapeXml(normalizeText(cell) || "—")}</td>`).join("")}</tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `)
        .join("");

      return `
        <section class="report-section" id="${escapeXml(section.id)}">
          <h2>${escapeXml(section.title)}</h2>
          ${paragraphs}
          ${bullets}
          ${tables}
        </section>
      `;
    })
    .join("");

  return `<!DOCTYPE html>
  <html lang="fr">
    <head>
      <meta charset="utf-8" />
      <title>${escapeXml(report.title)}</title>
      <style>
        body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; background: #f8fafc; }
        .page { max-width: 1080px; margin: 0 auto; padding: 32px 24px 48px; }
        h1 { font-size: 28px; margin: 0 0 8px; }
        .meta { color: #4b5563; margin-bottom: 24px; }
        .report-section { background: #fff; border: 1px solid #d1d5db; border-radius: 12px; padding: 18px 18px 12px; margin-bottom: 18px; }
        .report-section h2 { font-size: 20px; margin: 0 0 12px; }
        p { line-height: 1.65; margin: 0 0 12px; }
        ul { margin: 0 0 12px 18px; padding: 0; }
        li { margin: 0 0 7px; line-height: 1.5; }
        .table-block { margin: 16px 0 18px; }
        .table-title { font-weight: 700; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; table-layout: auto; }
        th, td { border: 1px solid #d1d5db; padding: 8px 10px; vertical-align: top; text-align: left; font-size: 13px; line-height: 1.45; word-break: break-word; white-space: normal; }
        th { background: #f3f4f6; }
      </style>
    </head>
    <body>
      <div class="page">
        <h1>${escapeXml(report.title)}</h1>
        <div class="meta">Généré le ${escapeXml(report.generatedAt)}</div>
        ${sectionHtml}
      </div>
    </body>
  </html>`;
}
