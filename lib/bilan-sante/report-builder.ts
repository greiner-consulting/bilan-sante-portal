// lib/bilan-sante/report-builder.ts

import { dimensionTitle } from "@/lib/bilan-sante/protocol";
import {
  assertComplianceOrThrow,
  type ComplianceReport,
} from "@/lib/bilan-sante/compliance-checker";
import type {
  DiagnosticSessionAggregate,
  FinalObjective,
  FrozenDimensionDiagnosis,
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
  consolidatedFindings: [string, string, string];
  dominantRootCause: string;
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

type BuildReportOptions = {
  companyLabel?: string;
  dirigeantLabel?: string;
};

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

function weakestDimension(
  frozenDimensions: ReadonlyArray<FrozenDimensionDiagnosis>
): FrozenDimensionDiagnosis | null {
  if (frozenDimensions.length === 0) return null;
  return [...frozenDimensions].sort((a, b) => a.score - b.score)[0] ?? null;
}

function buildExecutiveSynthesis(session: DiagnosticSessionAggregate) {
  const frozenDimensions = getFrozenDimensions(session);
  const avg = averageScore(frozenDimensions);
  const weakest = weakestDimension(frozenDimensions);

  const strengths = [...frozenDimensions]
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(
      (frozen) =>
        `${dimensionTitle(frozen.dimensionId)} — ${frozen.consolidatedFindings[0]}`
    );

  const vulnerabilities = [...frozenDimensions]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(
      (frozen) =>
        `${dimensionTitle(frozen.dimensionId)} — ${
          frozen.unmanagedZones[0]?.risqueManagerial ?? frozen.dominantRootCause
        }`
    );

  const objectiveLabels = getFinalObjectives(session)
    .slice(0, 5)
    .map((objective) => objective.objectiveLabel);

  return {
    globalScore: avg,
    globalLevel: globalLevelFromAverage(avg),
    synthesis: weakest
      ? `Le diagnostic 4D fait ressortir une performance managériale globalement ${globalLevelFromAverage(
          avg
        ).toLowerCase()}, avec un point de fragilité dominant sur la dimension "${dimensionTitle(
          weakest.dimensionId
        )}". Les constats gelés convergent vers des enjeux de pilotage qui affectent la robustesse économique, la tenue des arbitrages et la capacité à transformer la performance attendue en résultats durables.`
      : "Le diagnostic 4D a été consolidé, mais aucune dimension gelée n’est disponible.",
    keyStrengths:
      strengths.length > 0
        ? strengths
        : ["Aucune force suffisamment consolidée à ce stade."],
    keyVulnerabilities:
      vulnerabilities.length > 0
        ? vulnerabilities
        : ["Aucune vulnérabilité suffisamment consolidée à ce stade."],
    majorIssue: weakest
      ? `${dimensionTitle(weakest.dimensionId)} — cause racine dominante : ${weakest.dominantRootCause}`
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
      { label: "Constat", value: zone.constat },
      { label: "Risque managérial", value: zone.risqueManagerial },
      { label: "Conséquence", value: zone.consequence },
    ],
  };
}

function buildSwot(frozen: FrozenDimensionDiagnosis): SwotTable {
  const forces = frozen.consolidatedFindings
    .map(
      (finding) =>
        `Capacité identifiée ou partiellement démontrée à partir du constat : ${finding}`
    )
    .slice(0, 3);

  const faiblesses = frozen.unmanagedZones.map((zone) => zone.constat).slice(0, 4);

  const opportunites = [
    `Réduction directe de l’exposition liée à la cause racine : ${frozen.dominantRootCause}`,
    `Amélioration de la robustesse de pilotage sur la dimension "${dimensionTitle(
      frozen.dimensionId
    )}"`,
    `Transformation plus régulière de la performance attendue en résultats observables`,
  ].slice(0, 4);

  const risques = frozen.unmanagedZones.map((zone) => zone.consequence).slice(0, 4);

  return {
    forces,
    faiblesses,
    opportunites,
    risques,
  };
}

function buildDimensionSection(
  frozen: FrozenDimensionDiagnosis
): DimensionReportSection {
  return {
    dimensionId: frozen.dimensionId,
    title: dimensionTitle(frozen.dimensionId),
    score: frozen.score,
    consolidatedFindings: frozen.consolidatedFindings,
    dominantRootCause: frozen.dominantRootCause,
    unmanagedZoneTables: frozen.unmanagedZones.map((zone, index) =>
      toZoneTable(zone, `Zone non pilotée ${index + 1}`)
    ),
    swot: buildSwot(frozen),
  };
}

function buildTransverseZones(session: DiagnosticSessionAggregate) {
  const frozenDimensions = getFrozenDimensions(session);

  const tables = frozenDimensions.flatMap((frozen) =>
    frozen.unmanagedZones.slice(0, 1).map((zone) =>
      toZoneTable(zone, `${dimensionTitle(frozen.dimensionId)} — zone dominante`)
    )
  );

  return {
    title: "Synthèse transverse des zones non pilotées",
    tables,
  };
}

function objectiveCard(objective: FinalObjective): ObjectiveCard {
  return {
    title: `Carte objectif — ${dimensionTitle(objective.dimensionId)}`,
    rows: [
      { label: "Objectif de résultat", value: objective.objectiveLabel },
      { label: "Owner", value: objective.owner },
      { label: "Indicateur clé", value: objective.keyIndicator },
      { label: "Échéance", value: objective.dueDate },
      {
        label: "Gain potentiel",
        value: `${objective.potentialGain} Hypothèses : ${objective.gainHypotheses.join(
          " | "
        )}`,
      },
      { label: "Statut validation dirigeant", value: objective.validationStatus },
      { label: "Quick win", value: objective.quickWin },
    ],
  };
}

function buildActionPlanCards(session: DiagnosticSessionAggregate) {
  return {
    title: "Plan d’actions — objectifs orientés résultats",
    cards: getFinalObjectives(session).map(objectiveCard),
  };
}

function buildLeaderConclusion(session: DiagnosticSessionAggregate) {
  const frozenDimensions = getFrozenDimensions(session);
  const weakest = weakestDimension(frozenDimensions);
  const strongest =
    [...frozenDimensions].sort((a, b) => b.score - a.score)[0] ?? null;

  const alignments: string[] = [];
  const misalignments: string[] = [];
  const contradictions: string[] = [];
  const globalImpacts: string[] = [];

  if (strongest) {
    alignments.push(
      `La dimension la plus robuste semble être "${dimensionTitle(
        strongest.dimensionId
      )}", ce qui constitue un appui potentiel pour sécuriser la mise en mouvement du plan d’actions.`
    );
  }

  if (weakest) {
    misalignments.push(
      `La dimension "${dimensionTitle(
        weakest.dimensionId
      )}" concentre l’écart principal entre fonctionnement attendu et fonctionnement observé.`
    );
  }

  if (
    frozenDimensions.some((d) => d.dimensionId === 2) &&
    frozenDimensions.some((d) => d.dimensionId === 3)
  ) {
    contradictions.push(
      "Une tension potentielle existe entre ambition commerciale, discipline de sélection des affaires et robustesse de la marge réellement tenue."
    );
  }

  if (
    frozenDimensions.some((d) => d.dimensionId === 1) &&
    frozenDimensions.some((d) => d.dimensionId === 4)
  ) {
    contradictions.push(
      "Une faiblesse de rôles, relais ou capacités peut amplifier directement les dérives d’exécution, de qualité ou de productivité."
    );
  }

  globalImpacts.push(
    "Les causes racines identifiées montrent que la performance économique ne dépend pas d’un seul sujet, mais d’un enchaînement entre pilotage, arbitrage, sélectivité et discipline d’exécution."
  );
  globalImpacts.push(
    "Le plan d’actions doit donc être lu comme une traduction structurée du diagnostic gelé, et non comme une liste libre de recommandations."
  );

  return {
    title: "Conclusion dirigeant — enjeux, impacts, cohérence globale",
    alignments,
    misalignments,
    contradictions,
    globalImpacts,
    closingStatement:
      "La cohérence globale du diagnostic repose sur la capacité du dirigeant à traiter en parallèle les dimensions les plus exposées, sans rouvrir le diagnostic gelé, mais en transformant ses constats en objectifs de résultat pilotables.",
  };
}

function buildConfidentialitySection() {
  return {
    title: "Confidentialité & anonymisation",
    rules: [
      "Aucun nom d’entreprise, de personne ou de localisation issue du corpus interne n’est reproduit.",
      "Toute référence au corpus interne reste générique et anonymisée.",
      "Le document doit être généré en Word (.docx) comme version de référence.",
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
      session.trame?.qualityFlags.map((flag) => `[${flag.severity}] ${flag.message}`) ??
      [],
    missingFieldSignals:
      session.trame?.missingFields.map(
        (field) =>
          `${field.label} — ${field.sourceText}${
            field.dimensionId ? ` (dimension ${field.dimensionId})` : ""
          }`
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
    summary: compliance.summary,
    warnings: compliance.warnings.map(
      (issue) => `[${issue.code}] ${issue.message}`
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
