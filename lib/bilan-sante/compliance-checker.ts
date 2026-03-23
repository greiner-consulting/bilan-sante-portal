// lib/bilan-sante/compliance-checker.ts

import { DIAGNOSTIC_DIMENSIONS, dimensionTitle } from "@/lib/bilan-sante/protocol";
import type {
  DiagnosticSessionAggregate,
  FinalObjective,
  FrozenDimensionDiagnosis,
} from "@/lib/bilan-sante/session-model";

export type ComplianceIssue = {
  code: string;
  severity: "blocking" | "warning";
  message: string;
};

export type ComplianceReport = {
  isCompliant: boolean;
  blockingIssues: ComplianceIssue[];
  warnings: ComplianceIssue[];
  summary: string[];
};

function pushBlocking(target: ComplianceIssue[], code: string, message: string) {
  target.push({ code, severity: "blocking", message });
}

function pushWarning(target: ComplianceIssue[], code: string, message: string) {
  target.push({ code, severity: "warning", message });
}

function uniqueDimensionIds(frozenDimensions: FrozenDimensionDiagnosis[]): number[] {
  return [...new Set(frozenDimensions.map((d) => d.dimensionId))].sort((a, b) => a - b);
}

function validateFrozenDimension(
  frozen: FrozenDimensionDiagnosis,
  blocking: ComplianceIssue[],
  warnings: ComplianceIssue[]
) {
  if (![1, 2, 3, 4].includes(frozen.dimensionId)) {
    pushBlocking(
      blocking,
      "INVALID_DIMENSION_ID",
      `Dimension gelée invalide détectée: ${String(frozen.dimensionId)}.`
    );
  }

  if (!Array.isArray(frozen.consolidatedFindings) || frozen.consolidatedFindings.length !== 3) {
    pushBlocking(
      blocking,
      "INVALID_FINDINGS_COUNT",
      `La dimension ${frozen.dimensionId} doit contenir exactement 3 constats consolidés.`
    );
  }

  if (
    Array.isArray(frozen.consolidatedFindings) &&
    frozen.consolidatedFindings.some((x) => String(x || "").trim().length < 12)
  ) {
    pushBlocking(
      blocking,
      "WEAK_FINDING_CONTENT",
      `Au moins un constat consolidé de la dimension ${frozen.dimensionId} est trop faible ou vide.`
    );
  }

  if (String(frozen.dominantRootCause || "").trim().length < 10) {
    pushBlocking(
      blocking,
      "MISSING_ROOT_CAUSE",
      `La dimension ${frozen.dimensionId} doit contenir exactement 1 cause racine dominante exploitable.`
    );
  }

  if (!Number.isInteger(frozen.score) || frozen.score < 1 || frozen.score > 5) {
    pushBlocking(
      blocking,
      "INVALID_DIMENSION_SCORE",
      `Le score de la dimension ${frozen.dimensionId} doit être compris entre 1 et 5.`
    );
  }

  if (!Array.isArray(frozen.unmanagedZones) || frozen.unmanagedZones.length === 0) {
    pushBlocking(
      blocking,
      "MISSING_UNMANAGED_ZONE",
      `La dimension ${frozen.dimensionId} doit contenir au moins une zone non pilotée.`
    );
  }

  for (const [index, zone] of frozen.unmanagedZones.entries()) {
    if (String(zone.constat || "").trim().length < 8) {
      pushBlocking(
        blocking,
        "INVALID_ZONE_CONSTAT",
        `La zone non pilotée #${index + 1} de la dimension ${frozen.dimensionId} n’a pas de constat exploitable.`
      );
    }

    if (String(zone.risqueManagerial || "").trim().length < 8) {
      pushBlocking(
        blocking,
        "INVALID_ZONE_RISK",
        `La zone non pilotée #${index + 1} de la dimension ${frozen.dimensionId} n’a pas de risque managérial exploitable.`
      );
    }

    if (String(zone.consequence || "").trim().length < 8) {
      pushBlocking(
        blocking,
        "INVALID_ZONE_CONSEQUENCE",
        `La zone non pilotée #${index + 1} de la dimension ${frozen.dimensionId} n’a pas de conséquence exploitable.`
      );
    }
  }

  const highExposure = frozen.unmanagedZones.some((zone) =>
    String(zone.risqueManagerial || "").toLowerCase().includes("insuffisamment")
  );

  if (frozen.score >= 4 && highExposure) {
    pushWarning(
      warnings,
      "SCORE_TENSION",
      `La dimension ${frozen.dimensionId} a un score élevé alors que plusieurs formulations signalent une fragilité importante.`
    );
  }
}

function objectivesByDimension(objectives: FinalObjective[]): Map<number, FinalObjective[]> {
  const map = new Map<number, FinalObjective[]>();

  for (const objective of objectives) {
    const bucket = map.get(objective.dimensionId) ?? [];
    bucket.push(objective);
    map.set(objective.dimensionId, bucket);
  }

  return map;
}

function validateObjectives(
  session: DiagnosticSessionAggregate,
  blocking: ComplianceIssue[],
  warnings: ComplianceIssue[]
) {
  const objectiveSet = session.finalObjectives;

  if (!objectiveSet) {
    pushBlocking(
      blocking,
      "MISSING_OBJECTIVE_SET",
      "La session ne contient pas d’ensemble d’objectifs finalisés."
    );
    return;
  }

  const objectives = objectiveSet.objectives ?? [];
  const count = objectives.length;

  if (count < 3 || count > 5) {
    pushBlocking(
      blocking,
      "INVALID_OBJECTIVE_COUNT",
      `Le plan d’actions doit contenir entre 3 et 5 objectifs. Nombre détecté: ${count}.`
    );
  }

  const ids = new Set<string>();
  for (const objective of objectives) {
    if (ids.has(objective.id)) {
      pushBlocking(
        blocking,
        "DUPLICATE_OBJECTIVE_ID",
        `Identifiant d’objectif dupliqué détecté: ${objective.id}.`
      );
    }
    ids.add(objective.id);

    if (String(objective.objectiveLabel || "").trim().length < 15) {
      pushBlocking(
        blocking,
        "WEAK_OBJECTIVE_LABEL",
        `L’objectif ${objective.id} n’est pas formulé de manière suffisamment exploitable.`
      );
    }

    if (String(objective.keyIndicator || "").trim().length < 10) {
      pushBlocking(
        blocking,
        "MISSING_OBJECTIVE_INDICATOR",
        `L’objectif ${objective.id} n’a pas d’indicateur clé exploitable.`
      );
    }

    if (String(objective.potentialGain || "").trim().length < 15) {
      pushBlocking(
        blocking,
        "MISSING_OBJECTIVE_GAIN",
        `L’objectif ${objective.id} n’a pas de formulation de gain potentiel exploitable.`
      );
    }

    if (!Array.isArray(objective.gainHypotheses) || objective.gainHypotheses.length === 0) {
      pushBlocking(
        blocking,
        "MISSING_GAIN_HYPOTHESES",
        `L’objectif ${objective.id} doit expliciter ses hypothèses de gain.`
      );
    }

    if (String(objective.quickWin || "").trim().length < 10) {
      pushWarning(
        warnings,
        "WEAK_QUICK_WIN",
        `Le quick win de l’objectif ${objective.id} est trop faible ou générique.`
      );
    }
  }

  const frozenByDimension = new Map(session.frozenDimensions.map((d) => [d.dimensionId, d]));
  const objectivesMap = objectivesByDimension(objectives);

  for (const dimension of DIAGNOSTIC_DIMENSIONS) {
    if (!frozenByDimension.has(dimension.id)) {
      pushBlocking(
        blocking,
        "MISSING_FROZEN_DIMENSION",
        `La dimension ${dimension.id} n’est pas gelée.`
      );
      continue;
    }

    const dimensionObjectives = objectivesMap.get(dimension.id) ?? [];
    if (dimensionObjectives.length === 0) {
      pushBlocking(
        blocking,
        "MISSING_DIMENSION_OBJECTIVE",
        `La dimension ${dimension.id} (${dimension.title}) doit être traitée par au moins un objectif de résultat.`
      );
    }
  }

  for (const objective of objectives) {
    const frozen = frozenByDimension.get(objective.dimensionId);

    if (!frozen) {
      pushBlocking(
        blocking,
        "OBJECTIVE_OUTSIDE_DIAGNOSTIC",
        `L’objectif ${objective.id} traite une dimension non identifiée dans le diagnostic gelé.`
      );
      continue;
    }

    if (String(frozen.dominantRootCause || "").trim().length === 0) {
      pushBlocking(
        blocking,
        "OBJECTIVE_WITHOUT_ROOT_CAUSE",
        `L’objectif ${objective.id} n’a pas de cause racine exploitable à laquelle se rattacher.`
      );
    }
  }

  const allRefused =
    objectives.length > 0 &&
    objectives.every((objective) => objective.validationStatus === "refused");

  if (allRefused) {
    pushWarning(
      warnings,
      "ALL_OBJECTIVES_REFUSED",
      "Tous les objectifs ont été refusés par le dirigeant. Le diagnostic reste exploitable, mais la restitution devra l’expliciter."
    );
  }

  if (!objectiveSet.decisionsCapturedAt) {
    pushWarning(
      warnings,
      "MISSING_OBJECTIVE_DECISION_TIMESTAMP",
      "La date de capture des décisions objectifs n’est pas renseignée."
    );
  }
}

export function runComplianceChecks(session: DiagnosticSessionAggregate): ComplianceReport {
  const blocking: ComplianceIssue[] = [];
  const warnings: ComplianceIssue[] = [];

  if (session.phase !== "report_ready") {
    pushBlocking(
      blocking,
      "INVALID_SESSION_PHASE",
      `La session doit être en phase "report_ready" avant génération du rapport. Phase actuelle: ${session.phase}.`
    );
  }

  if (!session.trame) {
    pushBlocking(
      blocking,
      "MISSING_TRAME",
      "Aucune trame structurée n’est attachée à la session."
    );
  }

  if (session.frozenDimensions.length !== 4) {
    pushBlocking(
      blocking,
      "INVALID_FROZEN_DIMENSION_COUNT",
      `Le diagnostic doit contenir exactement 4 dimensions gelées. Nombre détecté: ${session.frozenDimensions.length}.`
    );
  }

  const uniqueDims = uniqueDimensionIds(session.frozenDimensions);
  const expectedDims = [1, 2, 3, 4];

  if (JSON.stringify(uniqueDims) !== JSON.stringify(expectedDims)) {
    pushBlocking(
      blocking,
      "INVALID_FROZEN_DIMENSION_SET",
      `Les dimensions gelées détectées sont ${uniqueDims.join(", ")} au lieu de 1, 2, 3, 4.`
    );
  }

  for (const frozen of session.frozenDimensions) {
    validateFrozenDimension(frozen, blocking, warnings);
  }

  validateObjectives(session, blocking, warnings);

  const summary: string[] = [
    `Phase session: ${session.phase}`,
    `Dimensions gelées: ${session.frozenDimensions.length}/4`,
    `Objectifs finaux: ${session.finalObjectives?.objectives?.length ?? 0}`,
    `Issues bloquantes: ${blocking.length}`,
    `Avertissements: ${warnings.length}`,
  ];

  return {
    isCompliant: blocking.length === 0,
    blockingIssues: blocking,
    warnings,
    summary,
  };
}

export function assertComplianceOrThrow(session: DiagnosticSessionAggregate): ComplianceReport {
  const report = runComplianceChecks(session);

  if (!report.isCompliant) {
    const details = report.blockingIssues.map((issue) => `- [${issue.code}] ${issue.message}`).join("\n");
    throw new Error(`REPORT_COMPLIANCE_FAILED\n${details}`);
  }

  return report;
}