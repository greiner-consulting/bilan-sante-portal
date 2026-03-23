export type ThemeStatus = "unseen" | "exploring" | "covered" | "resolved";

export type FactDimension = 1 | 2 | 3 | 4;

export type FactSource =
  | "trame"
  | "user_answer"
  | "historical_pattern"
  | "inference";

export type FactType =
  | "economic_fact"
  | "commercial_fact"
  | "organisational_fact"
  | "operational_fact";

export type EvidenceKind =
  | "explicit_fact"
  | "weak_signal"
  | "user_confirmed"
  | "user_refuted";

export type ReasoningStatus =
  | "raw"
  | "to_instruct"
  | "partially_supported"
  | "supported"
  | "refuted"
  | "contradicted";

export type StatementMode =
  | "fact_only"
  | "prudent_hypothesis"
  | "validated_finding";

/**
 * Ancien pilotage "but de question".
 * Conservé temporairement pour compatibilité pendant la reprise.
 */
export type InstructionGoal =
  | "quantify"
  | "verify"
  | "explain_cause"
  | "test_arbitration"
  | "measure_impact";

/**
 * Nouvelle maille métier : angle d'exploration.
 * C'est ce qui permettra de distinguer réellement les itérations
 * et d'éviter les répétitions faibles.
 */
export type SignalAngle =
  | "example"
  | "magnitude"
  | "mechanism"
  | "causality"
  | "dependency"
  | "arbitration"
  | "formalization"
  | "transition"
  | "economics"
  | "frequency"
  | "feedback";

/**
 * Progression réelle d'un signal dans l'entretien.
 * Plus utile métierement que le seul niveau de "support" logique.
 */
export type SignalProgress =
  | "identified"
  | "questioned"
  | "illustrated"
  | "quantified"
  | "causalized"
  | "arbitrated"
  | "stabilized"
  | "consolidated";

export type QuestionDisplayMode =
  | "point_to_clarify"
  | "prudent_observation"
  | "validated_finding";

export type JudgeDecision = "accept" | "rewrite" | "reject";

export type JudgeSeverity = "low" | "medium" | "high";

export type QuestionQualityCriterion =
  | "proof_discipline"
  | "factual_anchor"
  | "decision_utility"
  | "non_generic_style"
  | "non_suggestive_wording"
  | "right_instruction_goal";

export type ThemeMap = Record<string, ThemeStatus>;

export type FinalObjective = {
  objectif: string;
  indicateur: string;
  echeance: string;
  gain_potentiel: string;
  hypotheses: string;
};

export type ConsolidationBlock = {
  constats_cles: string[];
  cause_racine: string;
  zones_non_pilotees: string[];
};

export type DimensionBrief = {
  priority_themes: string[];
  risky_signals: string[];
  likely_hypotheses: string[];
  economic_markers: string[];
};

export type GlobalTrameAnalysis = {
  summary: string;
  company_context: string[];
  major_signals: string[];
  blind_spots: string[];
  economic_markers: string[];
  strategic_tensions: string[];
  dimension_briefs: Record<string, DimensionBrief>;
};

/**
 * Objet métier pivot.
 *
 * Il reste compatible avec l'existant,
 * mais il porte maintenant les briques nécessaires pour :
 * - suivre un signal dans le temps,
 * - savoir quels angles ont déjà été explorés,
 * - distinguer itération 1 / 2 / 3 de manière utile.
 */
export type DiagnosticFact = {
  id: string;
  dimension_primary: FactDimension;
  dimension_secondary: FactDimension[];
  fact_type: FactType;
  theme: string;

  observed_element: string;
  source: FactSource;
  source_excerpt?: string;
  numeric_values?: Record<string, number | string>;
  tags: string[];

  evidence_kind: EvidenceKind;
  proof_level: 1 | 2 | 3 | 4 | 5;
  reasoning_status: ReasoningStatus;

  prudent_hypothesis?: string;
  managerial_risk?: string;
  instruction_goal: InstructionGoal;
  allowed_statement_mode: StatementMode;

  confidence_score: number;
  criticality_score: number;
  asked_count: number;
  last_question_at?: string;
  evidence_refs: string[];
  contradiction_notes: string[];

  /**
   * Champs introduits pour la reprise structurante.
   * Ils sont exploités ensuite dans diagnosticState / planner.
   */
  progress?: SignalProgress;
  asked_angles?: SignalAngle[];
  missing_angles?: SignalAngle[];
  last_planned_angle?: SignalAngle;
  first_seen_iteration?: 1 | 2 | 3;
  last_completed_iteration?: 1 | 2 | 3;
  linked_fact_ids?: string[];
};

export type QuestionCandidate = {
  fact_id: string;
  theme: string;
  display_mode: QuestionDisplayMode;
  anchor: string;
  hypothesis?: string;
  managerial_risk?: string;
  question: string;

  /**
   * Angle visé par la question.
   * C'est ce champ qui devra devenir central dans le planner.
   */
  intended_angle?: SignalAngle;

  /**
   * Champ utile pour expliquer au moteur pourquoi cette question existe,
   * pas pour l'affichage utilisateur.
   */
  planner_rationale?: string;
};

/**
 * Contrat affiché au front.
 * Il doit refléter la structure métier attendue par ton produit.
 */
export type StructuredQuestion = {
  fact_id: string;
  theme: string;
  constat: string;
  risque_managerial: string;
  question: string;
};

export type FactBackedQuestion = StructuredQuestion & {
  display_mode?: QuestionDisplayMode;
  anchor?: string;
  hypothesis?: string;
  intended_angle?: SignalAngle;
  planner_rationale?: string;
};

export type QuestionJudgmentViolation = {
  criterion: QuestionQualityCriterion;
  severity: JudgeSeverity;
  message: string;
};

export type QuestionJudgment = {
  decision: JudgeDecision;
  score: number;
  strengths: string[];
  violations: QuestionJudgmentViolation[];
  rewritten_candidate?: QuestionCandidate;
};

export type CoverageBucket = {
  asked: string[];
  coveredThemes: string[];
  validations: string[];
  learned_facts: string[];
  signals: string[];
  evidences: string[];
  validated_findings: string[];
  open_hypotheses: string[];
  resolved_topics: string[];
  contradictions: string[];
  theme_status: ThemeMap;
  sufficiency_score: number;
  last_best_angles: string[];
  planned_themes: string[];
  critical_uncovered_themes: string[];
  targeted_fact_ids: string[];
  confirmed_fact_ids: string[];
  contradicted_fact_ids: string[];
  unresolved_fact_ids: string[];

  /**
   * Nouvelles briques de mémoire pilotable.
   * Elles cohabitent temporairement avec la mémoire textuelle existante.
   */
  recent_angles?: SignalAngle[];
  planned_angles?: SignalAngle[];
};

export type CoverageState = {
  version: 6;
  global_analysis: GlobalTrameAnalysis | null;
  fact_inventory: DiagnosticFact[];
  dimensions: Record<string, CoverageBucket>;
};

export type DiagnosticDimensionResult = {
  dimension: number;
  name: string;
  coverage_score: number;
  constats_cles: string[];
  cause_racine: string;
  zones_non_pilotees: string[];
  validated_findings: string[];
  evidences: string[];
  signals: string[];
  open_hypotheses: string[];
};

export type DiagnosticResult = {
  synthesis: string;
  dimensions: DiagnosticDimensionResult[];
  transformation_priorities: string[];
  objectives: FinalObjective[];
};

export type AnalysisStep = {
  new_signals: string[];
  new_evidences: string[];
  validated_findings: string[];
  open_hypotheses: string[];
  resolved_topics: string[];
  contradictions: string[];
  covered_themes: string[];
  theme_status_updates: Array<{
    theme: string;
    status: ThemeStatus;
  }>;
  next_best_angle: string;
  confidence_score: number;

  /**
   * Champs de structuration pour la suite.
   * Optionnels pour ne pas casser le flux actuel immédiatement.
   */
  covered_angles?: SignalAngle[];
  signal_updates?: Array<{
    fact_id: string;
    progress?: SignalProgress;
    newly_covered_angles?: SignalAngle[];
    remaining_angles?: SignalAngle[];
  }>;
};

export type QuestionJudgeInput = {
  dimension: FactDimension;
  iteration: number;
  mode: "normal" | "reopen_after_no";
  fact: DiagnosticFact;
  candidate: QuestionCandidate;
  allowedThemes: string[];
  forbiddenThemes: string[];
  evidenceExpectations: string[];
  confusionRisks: string[];
};

export function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTheme(value: string) {
  return normalizeText(value).replace(/[’'"]/g, "");
}

export function normalizeAngle(value: string): SignalAngle | null {
  const x = normalizeText(value);

  if (x === "example" || x === "cas" || x === "illustration") return "example";
  if (x === "magnitude" || x === "ordre de grandeur" || x === "quantification")
    return "magnitude";
  if (x === "mechanism" || x === "mecanisme") return "mechanism";
  if (x === "causality" || x === "cause" || x === "causalite") return "causality";
  if (x === "dependency" || x === "dependance") return "dependency";
  if (x === "arbitration" || x === "arbitrage") return "arbitration";
  if (x === "formalization" || x === "formalisme") return "formalization";
  if (x === "transition") return "transition";
  if (x === "economics" || x === "economic" || x === "economique")
    return "economics";
  if (x === "frequency" || x === "frequence") return "frequency";
  if (x === "feedback" || x === "rex" || x === "retour d experience")
    return "feedback";

  return null;
}

export function clampProofLevel(value: unknown): 1 | 2 | 3 | 4 | 5 {
  const n = Number(value);
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 4;
  return 5;
}

export function clampScore0to100(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function inferDisplayModeFromFact(
  fact: Pick<DiagnosticFact, "proof_level" | "allowed_statement_mode">
): QuestionDisplayMode {
  if (fact.allowed_statement_mode === "validated_finding" || fact.proof_level >= 4) {
    return "validated_finding";
  }
  if (fact.allowed_statement_mode === "prudent_hypothesis" || fact.proof_level === 3) {
    return "prudent_observation";
  }
  return "point_to_clarify";
}

export function inferAllowedStatementMode(proofLevel: number): StatementMode {
  if (proofLevel >= 4) return "validated_finding";
  if (proofLevel === 3) return "prudent_hypothesis";
  return "fact_only";
}

export function inferEvidenceKindFromSourceExcerpt(
  sourceExcerpt?: string
): EvidenceKind {
  const text = normalizeText(sourceExcerpt || "");
  if (!text) return "weak_signal";
  if (/\b\d+([.,]\d+)?\b/.test(text)) return "explicit_fact";
  if (
    text.includes("hausse") ||
    text.includes("baisse") ||
    text.includes("retard") ||
    text.includes("dependance") ||
    text.includes("marge") ||
    text.includes("tresorerie") ||
    text.includes("turnover")
  ) {
    return "explicit_fact";
  }
  return "weak_signal";
}

/**
 * Ancienne logique de mapping conservée temporairement.
 * Le planner cible devra ensuite raisonner d'abord en SignalAngle,
 * puis seulement convertir si nécessaire.
 */
export function inferInstructionGoalFromFact(
  fact: Pick<
    DiagnosticFact,
    "numeric_values" | "managerial_risk" | "prudent_hypothesis" | "theme"
  >
): InstructionGoal {
  if (fact.numeric_values && Object.keys(fact.numeric_values).length > 0) {
    return "measure_impact";
  }

  const risk = normalizeText(fact.managerial_risk || "");
  const hypothesis = normalizeText(fact.prudent_hypothesis || "");
  const theme = normalizeTheme(fact.theme || "");

  if (
    risk.includes("cash") ||
    risk.includes("marge") ||
    risk.includes("rentabilite") ||
    risk.includes("production")
  ) {
    return "measure_impact";
  }

  if (
    hypothesis.includes("cause") ||
    hypothesis.includes("mecanisme") ||
    theme.includes("marge") ||
    theme.includes("prix") ||
    theme.includes("derives")
  ) {
    return "explain_cause";
  }

  if (
    theme.includes("gouvernance") ||
    theme.includes("roles") ||
    theme.includes("relais") ||
    theme.includes("arbitrage")
  ) {
    return "test_arbitration";
  }

  return "verify";
}

export function convertCandidateToStructuredQuestion(
  candidate: QuestionCandidate
): FactBackedQuestion {
  const prefix =
    candidate.display_mode === "validated_finding"
      ? "Constat"
      : candidate.display_mode === "prudent_observation"
      ? "Observation prudente"
      : "Point à clarifier";

  const constatParts = [candidate.anchor];
  if (candidate.display_mode !== "point_to_clarify" && candidate.hypothesis) {
    constatParts.push(candidate.hypothesis);
  }

  return {
    fact_id: candidate.fact_id,
    theme: candidate.theme,
    display_mode: candidate.display_mode,
    anchor: candidate.anchor,
    hypothesis: candidate.hypothesis,
    intended_angle: candidate.intended_angle,
    planner_rationale: candidate.planner_rationale,
    constat: `${prefix} : ${constatParts.filter(Boolean).join(" ")}`.trim(),
    risque_managerial: candidate.managerial_risk?.trim() || "",
    question: candidate.question.trim(),
  };
}