import type {
  AnalysisStep,
  CoverageBucket,
  CoverageState,
  DiagnosticFact,
  DiagnosticResult,
  DiagnosticDimensionResult,
  DimensionBrief,
  FactBackedQuestion,
  FactDimension,
  FactType,
  FinalObjective,
  GlobalTrameAnalysis,
  SignalAngle,
  SignalProgress,
  StatementMode,
  ThemeMap,
  ThemeStatus,
} from "@/lib/diagnostic/types";
import {
  clampProofLevel,
  clampScore0to100,
  inferAllowedStatementMode,
  inferEvidenceKindFromSourceExcerpt,
  normalizeAngle,
  normalizeText,
  normalizeTheme,
} from "@/lib/diagnostic/types";
import {
  DIMENSION_GUARDRAILS,
  clampDimension,
  factTypeForDimension,
  toDimensionKey,
  type IterationMode,
} from "@/lib/diagnostic/diagnosticContracts";

const INTENT_PREFIX = "intent:";

const DEFAULT_ITERATION_1_ANGLES: SignalAngle[] = [
  "mechanism",
  "formalization",
  "dependency",
  "frequency",
  "magnitude",
  "example",
];

const DEFAULT_ITERATION_2_ANGLES: SignalAngle[] = [
  "dependency",
  "arbitration",
  "causality",
  "mechanism",
  "economics",
];

const DEFAULT_ITERATION_3_ANGLES: SignalAngle[] = [
  "causality",
  "arbitration",
  "transition",
  "feedback",
  "economics",
];

export function emptyDimensionBrief(): DimensionBrief {
  return {
    priority_themes: [],
    risky_signals: [],
    likely_hypotheses: [],
    economic_markers: [],
  };
}

export function defaultGlobalAnalysis(): GlobalTrameAnalysis {
  return {
    summary:
      "La trame n’a pas encore été synthétisée globalement de manière suffisamment exploitable.",
    company_context: [],
    major_signals: [],
    blind_spots: [],
    economic_markers: [],
    strategic_tensions: [],
    dimension_briefs: {
      "1": emptyDimensionBrief(),
      "2": emptyDimensionBrief(),
      "3": emptyDimensionBrief(),
      "4": emptyDimensionBrief(),
    },
  };
}

export function defaultThemeStatus(dimension: number): ThemeMap {
  const d = clampDimension(dimension);
  const map: ThemeMap = {};

  for (const theme of DIMENSION_GUARDRAILS[d].allowedThemes) {
    map[normalizeTheme(theme)] = "unseen";
  }

  return map;
}

export function defaultBucket(dimension = 1): CoverageBucket {
  return {
    asked: [],
    coveredThemes: [],
    validations: [],
    learned_facts: [],
    signals: [],
    evidences: [],
    validated_findings: [],
    open_hypotheses: [],
    resolved_topics: [],
    contradictions: [],
    theme_status: defaultThemeStatus(dimension),
    sufficiency_score: 0,
    last_best_angles: [],
    planned_themes: [],
    critical_uncovered_themes: [],
    targeted_fact_ids: [],
    confirmed_fact_ids: [],
    contradicted_fact_ids: [],
    unresolved_fact_ids: [],
    recent_angles: [],
    planned_angles: [],
  };
}

export function defaultCoverage(): CoverageState {
  return {
    version: 6,
    global_analysis: null,
    fact_inventory: [],
    dimensions: {
      "1": defaultBucket(1),
      "2": defaultBucket(2),
      "3": defaultBucket(3),
      "4": defaultBucket(4),
    },
  };
}

export function defaultDiagnosticResult(): DiagnosticResult {
  return {
    synthesis:
      "Le diagnostic global est en cours de structuration. Les dimensions consolidées viendront enrichir progressivement cette synthèse.",
    dimensions: [],
    transformation_priorities: [],
    objectives: [],
  };
}

function normalizeDimensionBrief(raw: any): DimensionBrief {
  return {
    priority_themes: Array.isArray(raw?.priority_themes)
      ? raw.priority_themes.map(String).filter(Boolean).slice(0, 8)
      : [],
    risky_signals: Array.isArray(raw?.risky_signals)
      ? raw.risky_signals.map(String).filter(Boolean).slice(0, 8)
      : [],
    likely_hypotheses: Array.isArray(raw?.likely_hypotheses)
      ? raw.likely_hypotheses.map(String).filter(Boolean).slice(0, 8)
      : [],
    economic_markers: Array.isArray(raw?.economic_markers)
      ? raw.economic_markers.map(String).filter(Boolean).slice(0, 8)
      : [],
  };
}

export function normalizeGlobalAnalysis(raw: unknown): GlobalTrameAnalysis {
  const base = defaultGlobalAnalysis();
  if (!raw || typeof raw !== "object") return base;

  return {
    summary: String((raw as any)?.summary ?? base.summary).trim(),
    company_context: Array.isArray((raw as any)?.company_context)
      ? (raw as any).company_context.map(String).filter(Boolean).slice(0, 8)
      : [],
    major_signals: Array.isArray((raw as any)?.major_signals)
      ? (raw as any).major_signals.map(String).filter(Boolean).slice(0, 10)
      : [],
    blind_spots: Array.isArray((raw as any)?.blind_spots)
      ? (raw as any).blind_spots.map(String).filter(Boolean).slice(0, 8)
      : [],
    economic_markers: Array.isArray((raw as any)?.economic_markers)
      ? (raw as any).economic_markers.map(String).filter(Boolean).slice(0, 10)
      : [],
    strategic_tensions: Array.isArray((raw as any)?.strategic_tensions)
      ? (raw as any).strategic_tensions.map(String).filter(Boolean).slice(0, 8)
      : [],
    dimension_briefs: {
      "1": normalizeDimensionBrief((raw as any)?.dimension_briefs?.["1"]),
      "2": normalizeDimensionBrief((raw as any)?.dimension_briefs?.["2"]),
      "3": normalizeDimensionBrief((raw as any)?.dimension_briefs?.["3"]),
      "4": normalizeDimensionBrief((raw as any)?.dimension_briefs?.["4"]),
    },
  };
}

function normalizeThemeStatus(raw: unknown, dimension: number): ThemeMap {
  const base = defaultThemeStatus(dimension);
  if (!raw || typeof raw !== "object") return base;

  const next = { ...base };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const t = normalizeTheme(key);
    if (!(t in next)) continue;
    const status = String(value || "").trim() as ThemeStatus;
    if (["unseen", "exploring", "covered", "resolved"].includes(status)) {
      next[t] = status;
    }
  }
  return next;
}

export function normalizeQuestionBatch(raw: any): FactBackedQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q: any) => ({
      fact_id: String(q?.fact_id ?? "").trim(),
      theme: String(q?.theme ?? "").trim(),
      constat: String(q?.constat ?? "").trim(),
      risque_managerial: String(
        q?.risque_managerial ?? q?.managerial_risk ?? ""
      ).trim(),
      question: String(q?.question ?? "").trim(),
      display_mode: q?.display_mode,
      anchor: String(q?.anchor ?? "").trim() || undefined,
      hypothesis: String(q?.hypothesis ?? "").trim() || undefined,
      intended_angle:
        normalizeAngle(String(q?.intended_angle ?? "").trim()) || undefined,
      planner_rationale:
        String(q?.planner_rationale ?? "").trim() || undefined,
    }))
    .filter(
      (q: FactBackedQuestion) =>
        q.fact_id.length > 0 &&
        q.theme.length > 0 &&
        q.constat.length > 0 &&
        q.question.length > 0 &&
        q.risque_managerial.length > 0
    );
}

function normalizeFinalObjectives(raw: unknown): FinalObjective[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((o: any) => ({
      objectif: String(o?.objectif ?? "").trim(),
      indicateur: String(o?.indicateur ?? "").trim(),
      echeance: String(o?.echeance ?? "").trim(),
      gain_potentiel: String(o?.gain_potentiel ?? "").trim(),
      hypotheses: String(o?.hypotheses ?? "").trim(),
    }))
    .filter(
      (o) =>
        o.objectif &&
        o.indicateur &&
        o.echeance &&
        o.gain_potentiel &&
        o.hypotheses
    );
}

function normalizeProgress(value: unknown): SignalProgress | undefined {
  const x = String(value ?? "").trim();
  if (
    x === "identified" ||
    x === "questioned" ||
    x === "illustrated" ||
    x === "quantified" ||
    x === "causalized" ||
    x === "arbitrated" ||
    x === "stabilized" ||
    x === "consolidated"
  ) {
    return x;
  }
  return undefined;
}

function normalizeAngleArray(value: unknown): SignalAngle[] {
  if (!Array.isArray(value)) return [];
  const out: SignalAngle[] = [];
  for (const item of value) {
    const angle = normalizeAngle(String(item ?? ""));
    if (angle && !out.includes(angle)) out.push(angle);
  }
  return out;
}

function normalizeStringArray(value: unknown, max = 10): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const text = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const key = normalizeText(text);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    out.push(text);

    if (out.length >= max) break;
  }

  return out;
}

function normalizeNumericValues(value: unknown): Record<string, number | string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: Record<string, number | string> = {};

  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) continue;

    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      out[cleanKey] = rawValue;
      continue;
    }

    const cleanValue = String(rawValue ?? "").replace(/\s+/g, " ").trim();
    if (cleanValue) out[cleanKey] = cleanValue;
  }

  return out;
}

function getFactTagValue(
  fact: Pick<DiagnosticFact, "tags">,
  prefix: string
): string | null {
  for (const tag of fact.tags ?? []) {
    const normalizedTag = String(tag || "").trim();
    if (!normalizedTag.startsWith(prefix)) continue;
    return normalizedTag.slice(prefix.length).trim() || null;
  }
  return null;
}

function getSignalKindFromFact(fact: Pick<DiagnosticFact, "tags">): string {
  return normalizeText(getFactTagValue(fact, "signal_kind:") || "");
}

function getRawSignalFromFact(
  fact: Pick<DiagnosticFact, "tags" | "observed_element">
): string {
  return (
    getFactTagValue(fact, "raw_signal:") ||
    fact.observed_element ||
    ""
  ).trim();
}

function getDiagnosticStatementFromFact(fact: DiagnosticFact): string {
  const rawFact = fact as any;

  return String(
    rawFact.diagnostic_statement ||
      getFactTagValue(fact, "diagnostic_statement:") ||
      getFactTagValue(fact, "raw_signal:") ||
      fact.observed_element ||
      fact.source_excerpt ||
      ""
  )
    .replace(/\s+/g, " ")
    .trim();
}

function getSuggestedQuestionsFromFact(fact: DiagnosticFact): string[] {
  const rawFact = fact as any;
  return normalizeStringArray(rawFact.suggested_questions, 5);
}

function hasNumericValues(fact: DiagnosticFact): boolean {
  return Boolean(
    fact.numeric_values &&
      typeof fact.numeric_values === "object" &&
      Object.keys(fact.numeric_values).length > 0
  );
}

function hasConversationMemory(fact: DiagnosticFact): boolean {
  const rawFact = fact as any;

  return (
    (Array.isArray(rawFact.previous_answers) &&
      rawFact.previous_answers.length > 0) ||
    (Array.isArray(rawFact.answer_summaries) &&
      rawFact.answer_summaries.length > 0) ||
    (Array.isArray(rawFact.validated_findings) &&
      rawFact.validated_findings.length > 0) ||
    (Array.isArray(rawFact.open_hypotheses) &&
      rawFact.open_hypotheses.length > 0)
  );
}

function defaultProgressForFact(raw: {
  proof_level: number;
  reasoning_status: string;
}): SignalProgress {
  if (raw.reasoning_status === "supported") return "stabilized";
  if (raw.reasoning_status === "partially_supported") return "illustrated";
  if (raw.reasoning_status === "to_instruct") return "identified";
  if (raw.reasoning_status === "raw") return "identified";
  return "identified";
}

function defaultAnglesForFact(fact: DiagnosticFact): SignalAngle[] {
  const theme = normalizeTheme(fact.theme || "");
  const risk = normalizeText(fact.managerial_risk || "");
  const statement = normalizeText(getDiagnosticStatementFromFact(fact));
  const signalKind = getSignalKindFromFact(fact);

  const base: SignalAngle[] = ["mechanism", "formalization"];

  if (hasNumericValues(fact) || /\b\d+([,.]\d+)?\b/.test(statement)) {
    base.push("magnitude", "economics");
  }

  if (
    statement.includes("ecart") ||
    statement.includes("retard") ||
    statement.includes("non imput") ||
    statement.includes("marge") ||
    statement.includes("ebitda") ||
    statement.includes("facturation") ||
    statement.includes("productivite")
  ) {
    base.push("causality", "economics", "magnitude");
  }

  if (
    statement.includes("qui") ||
    statement.includes("responsable") ||
    statement.includes("chef d agence") ||
    statement.includes("manager") ||
    statement.includes("arbitrage") ||
    statement.includes("decide")
  ) {
    base.push("dependency", "arbitration");
  }

  if (
    statement.includes("formalise") ||
    statement.includes("strategie") ||
    statement.includes("procedure") ||
    statement.includes("outil") ||
    statement.includes("indicateur") ||
    statement.includes("rituel")
  ) {
    base.push("formalization", "transition");
  }

  if (fact.dimension_primary === 1) {
    if (
      theme.includes("gouvernance") ||
      theme.includes("roles et responsabilites") ||
      theme.includes("ligne manageriale") ||
      theme.includes("relais d encadrement") ||
      theme.includes("autonomie encadrement") ||
      signalKind.includes("managerial") ||
      signalKind.includes("centralization")
    ) {
      base.push("dependency", "arbitration", "causality");
    }

    if (
      theme.includes("competences critiques") ||
      theme.includes("dependances humaines") ||
      signalKind.includes("dependency") ||
      signalKind.includes("critical_skill")
    ) {
      base.push("dependency", "causality", "economics");
    }

    if (theme.includes("recrutement")) {
      base.push("dependency", "causality", "economics");
    }

    if (
      theme.includes("climat social") ||
      theme.includes("adhesion des equipes")
    ) {
      base.push("frequency", "causality", "dependency");
    }

    if (
      theme.includes("rituels manageriaux") ||
      theme.includes("structure de pilotage")
    ) {
      base.push("frequency", "arbitration", "dependency");
    }

    if (
      theme.includes("organisation interne") ||
      theme.includes("dimensionnement structure")
    ) {
      base.push("dependency", "causality", "economics");
    }

    if (fact.instruction_goal === "measure_impact") {
      base.push("economics", "magnitude");
    }

    return limitUnique(base, 8).filter(isSignalAngle);
  }

  if (
    theme.includes("marge") ||
    theme.includes("prix") ||
    theme.includes("rentabilite") ||
    theme.includes("productivite") ||
    risk.includes("marge") ||
    risk.includes("rentabilite")
  ) {
    base.push("magnitude", "economics", "causality");
  }

  if (fact.instruction_goal === "measure_impact") {
    base.push("economics", "magnitude");
  }
  if (fact.instruction_goal === "test_arbitration") {
    base.push("arbitration");
  }
  if (fact.instruction_goal === "explain_cause") {
    base.push("causality", "dependency");
  }

  return limitUnique(base, 8).filter(isSignalAngle);
}

function isSignalAngle(value: string): value is SignalAngle {
  return (
    value === "example" ||
    value === "magnitude" ||
    value === "mechanism" ||
    value === "causality" ||
    value === "dependency" ||
    value === "arbitration" ||
    value === "formalization" ||
    value === "transition" ||
    value === "economics" ||
    value === "frequency" ||
    value === "feedback"
  );
}

function buildMissingAngles(
  progress: SignalProgress,
  askedAngles: SignalAngle[],
  defaults: SignalAngle[]
): SignalAngle[] {
  const target = new Set<SignalAngle>(defaults);

  if (progress === "identified") {
    target.add("mechanism");
    target.add("formalization");
  }

  if (progress === "questioned") {
    target.add("mechanism");
    target.add("dependency");
  }

  if (progress === "illustrated") {
    target.add("dependency");
    target.add("arbitration");
  }

  if (progress === "quantified") {
    target.add("causality");
    target.add("arbitration");
  }

  if (progress === "causalized") {
    target.add("arbitration");
    target.add("economics");
  }

  if (progress === "arbitrated") {
    target.add("transition");
    target.add("feedback");
  }

  return [...target].filter((angle) => !askedAngles.includes(angle));
}

export function normalizeDiagnosticFact(raw: any): DiagnosticFact | null {
  const dimensionPrimary = Number(raw?.dimension_primary ?? 0) as FactDimension;
  if (![1, 2, 3, 4].includes(dimensionPrimary)) return null;

  const factType = String(raw?.fact_type ?? "").trim() as FactType;
  if (
    ![
      "economic_fact",
      "commercial_fact",
      "organisational_fact",
      "operational_fact",
    ].includes(factType)
  ) {
    return null;
  }

  const source = String(raw?.source ?? "trame").trim() as
    | "trame"
    | "user_answer"
    | "historical_pattern"
    | "inference";
  if (
    !["trame", "user_answer", "historical_pattern", "inference"].includes(source)
  ) {
    return null;
  }

  const reasoningStatus = String(
    raw?.reasoning_status ?? "to_instruct"
  ).trim() as
    | "raw"
    | "to_instruct"
    | "partially_supported"
    | "supported"
    | "refuted"
    | "contradicted";

  if (
    ![
      "raw",
      "to_instruct",
      "partially_supported",
      "supported",
      "refuted",
      "contradicted",
    ].includes(reasoningStatus)
  ) {
    return null;
  }

  const proofLevel = clampProofLevel(raw?.proof_level ?? 2);
  const allowedStatementMode =
    raw?.allowed_statement_mode === "validated_finding" ||
    raw?.allowed_statement_mode === "prudent_hypothesis" ||
    raw?.allowed_statement_mode === "fact_only"
      ? (raw.allowed_statement_mode as StatementMode)
      : inferAllowedStatementMode(proofLevel);

  const tags = Array.isArray(raw?.tags)
    ? raw.tags.map(String).filter(Boolean).slice(0, 20)
    : [];

  const diagnosticStatement = String(
    raw?.diagnostic_statement ??
      raw?.observed_element ??
      raw?.raw_signal ??
      raw?.statement ??
      ""
  )
    .replace(/\s+/g, " ")
    .trim();

  const rawSignal = String(raw?.raw_signal ?? "").replace(/\s+/g, " ").trim();
  const suggestedQuestions = normalizeStringArray(raw?.suggested_questions, 5);
  const previousQuestions = normalizeStringArray(raw?.previous_questions, 10);
  const previousAnswers = normalizeStringArray(raw?.previous_answers, 10);
  const answerSummaries = normalizeStringArray(raw?.answer_summaries, 10);
  const factValidatedFindings = normalizeStringArray(
    raw?.validated_findings,
    10
  );
  const factOpenHypotheses = normalizeStringArray(raw?.open_hypotheses, 10);
  const nextQuestionHints = normalizeStringArray(raw?.next_question_hints, 10);

  if (
  diagnosticStatement &&
  !tags.some((t: string) => t.startsWith("diagnostic_statement:"))
) {
  tags.push(`diagnostic_statement:${diagnosticStatement.slice(0, 700)}`);

  }
if (
  rawSignal &&
  !tags.some((t: string) => t.startsWith("raw_signal:"))
) {
  tags.push(`raw_signal:${rawSignal.slice(0, 700)}`);
}
 

  const fact: DiagnosticFact = {
    id: String(raw?.id ?? "").trim(),
    dimension_primary: dimensionPrimary,
    dimension_secondary: Array.isArray(raw?.dimension_secondary)
      ? raw.dimension_secondary
          .map((x: any) => Number(x))
          .filter((x: number) => [1, 2, 3, 4].includes(x))
      : [],
    fact_type: factType,
    theme: String(raw?.theme ?? "").trim(),
    observed_element: diagnosticStatement,
    source,
    source_excerpt: String(raw?.source_excerpt ?? "").trim() || undefined,
    numeric_values: normalizeNumericValues(raw?.numeric_values),
    tags,
    evidence_kind:
      raw?.evidence_kind === "explicit_fact" ||
      raw?.evidence_kind === "weak_signal" ||
      raw?.evidence_kind === "user_confirmed" ||
      raw?.evidence_kind === "user_refuted"
        ? raw.evidence_kind
        : inferEvidenceKindFromSourceExcerpt(raw?.source_excerpt),
    proof_level: proofLevel,
    reasoning_status: reasoningStatus,
    prudent_hypothesis:
      String(raw?.prudent_hypothesis ?? "").trim() || undefined,
    managerial_risk:
      String(raw?.managerial_risk ?? raw?.risk ?? "").trim() || undefined,
    instruction_goal:
      raw?.instruction_goal === "quantify" ||
      raw?.instruction_goal === "verify" ||
      raw?.instruction_goal === "explain_cause" ||
      raw?.instruction_goal === "test_arbitration" ||
      raw?.instruction_goal === "measure_impact"
        ? raw.instruction_goal
        : "verify",
    allowed_statement_mode: allowedStatementMode,
    confidence_score: clampScore0to100(raw?.confidence_score ?? 0),
    criticality_score: clampScore0to100(raw?.criticality_score ?? 0),
    asked_count: Math.max(0, Number(raw?.asked_count ?? 0)),
    last_question_at: String(raw?.last_question_at ?? "").trim() || undefined,
    evidence_refs: Array.isArray(raw?.evidence_refs)
      ? raw.evidence_refs.map(String).filter(Boolean).slice(0, 12)
      : [],
    contradiction_notes: Array.isArray(raw?.contradiction_notes)
      ? raw.contradiction_notes.map(String).filter(Boolean).slice(0, 8)
      : [],
    progress: undefined,
    asked_angles: [],
    missing_angles: [],
    last_planned_angle: undefined,
    first_seen_iteration:
      raw?.first_seen_iteration === 1 ||
      raw?.first_seen_iteration === 2 ||
      raw?.first_seen_iteration === 3
        ? raw.first_seen_iteration
        : 1,
    last_completed_iteration:
      raw?.last_completed_iteration === 1 ||
      raw?.last_completed_iteration === 2 ||
      raw?.last_completed_iteration === 3
        ? raw.last_completed_iteration
        : undefined,
    linked_fact_ids: Array.isArray(raw?.linked_fact_ids)
      ? raw.linked_fact_ids.map(String).filter(Boolean).slice(0, 12)
      : [],

    previous_questions: previousQuestions,
    previous_answers: previousAnswers,
    answer_summaries: answerSummaries,
    validated_findings: factValidatedFindings,
    open_hypotheses: factOpenHypotheses,
    next_question_hints: nextQuestionHints,
  };

  (fact as any).diagnostic_statement = diagnosticStatement;
  (fact as any).raw_signal = rawSignal;
  (fact as any).suggested_questions = suggestedQuestions;

  if (!fact.id || !fact.theme || !fact.observed_element) return null;

  const progress =
    normalizeProgress(raw?.progress) ||
    defaultProgressForFact({
      proof_level: fact.proof_level,
      reasoning_status: fact.reasoning_status,
    });

  const askedAngles = normalizeAngleArray(raw?.asked_angles);
  const defaultAngles = defaultAnglesForFact(fact);
  const missingAngles = normalizeAngleArray(raw?.missing_angles);
  const normalizedMissing =
    missingAngles.length > 0
      ? missingAngles.filter((x) => !askedAngles.includes(x))
      : buildMissingAngles(progress, askedAngles, defaultAngles);

  fact.progress = progress;
  fact.asked_angles = askedAngles;
  fact.missing_angles = normalizedMissing;
  fact.last_planned_angle =
    normalizeAngle(String(raw?.last_planned_angle ?? "").trim()) || undefined;

  return fact;
}

function normalizeBucket(raw: any, dimension: number): CoverageBucket {
  const base = defaultBucket(dimension);
  return {
    asked: Array.isArray(raw?.asked) ? raw.asked.map(String) : base.asked,
    coveredThemes: Array.isArray(raw?.coveredThemes)
      ? raw.coveredThemes.map(String)
      : base.coveredThemes,
    validations: Array.isArray(raw?.validations)
      ? raw.validations.map(String)
      : base.validations,
    learned_facts: Array.isArray(raw?.learned_facts)
      ? raw.learned_facts.map(String)
      : base.learned_facts,
    signals: Array.isArray(raw?.signals) ? raw.signals.map(String) : base.signals,
    evidences: Array.isArray(raw?.evidences)
      ? raw.evidences.map(String)
      : base.evidences,
    validated_findings: Array.isArray(raw?.validated_findings)
      ? raw.validated_findings.map(String)
      : base.validated_findings,
    open_hypotheses: Array.isArray(raw?.open_hypotheses)
      ? raw.open_hypotheses.map(String)
      : base.open_hypotheses,
    resolved_topics: Array.isArray(raw?.resolved_topics)
      ? raw.resolved_topics.map(String)
      : base.resolved_topics,
    contradictions: Array.isArray(raw?.contradictions)
      ? raw.contradictions.map(String)
      : base.contradictions,
    theme_status: normalizeThemeStatus(raw?.theme_status, dimension),
    sufficiency_score: Number.isFinite(Number(raw?.sufficiency_score))
      ? Number(raw.sufficiency_score)
      : base.sufficiency_score,
    last_best_angles: Array.isArray(raw?.last_best_angles)
      ? raw.last_best_angles.map(String)
      : base.last_best_angles,
    planned_themes: Array.isArray(raw?.planned_themes)
      ? raw.planned_themes.map(String)
      : base.planned_themes,
    critical_uncovered_themes: Array.isArray(raw?.critical_uncovered_themes)
      ? raw.critical_uncovered_themes.map(String)
      : base.critical_uncovered_themes,
    targeted_fact_ids: Array.isArray(raw?.targeted_fact_ids)
      ? raw.targeted_fact_ids.map(String)
      : base.targeted_fact_ids,
    confirmed_fact_ids: Array.isArray(raw?.confirmed_fact_ids)
      ? raw.confirmed_fact_ids.map(String)
      : base.confirmed_fact_ids,
    contradicted_fact_ids: Array.isArray(raw?.contradicted_fact_ids)
      ? raw.contradicted_fact_ids.map(String)
      : base.contradicted_fact_ids,
    unresolved_fact_ids: Array.isArray(raw?.unresolved_fact_ids)
      ? raw.unresolved_fact_ids.map(String)
      : base.unresolved_fact_ids,
    recent_angles: normalizeAngleArray(raw?.recent_angles),
    planned_angles: normalizeAngleArray(raw?.planned_angles),
  };
}

export function normalizeCoverage(raw: any): CoverageState {
  const base = defaultCoverage();
  if (!raw || typeof raw !== "object") return base;

  return {
    version: 6,
    global_analysis: raw?.global_analysis
      ? normalizeGlobalAnalysis(raw?.global_analysis)
      : null,
    fact_inventory: Array.isArray(raw?.fact_inventory)
      ? (raw.fact_inventory
          .map(normalizeDiagnosticFact)
          .filter(Boolean) as DiagnosticFact[])
      : [],
    dimensions: {
      "1": normalizeBucket(raw?.dimensions?.["1"], 1),
      "2": normalizeBucket(raw?.dimensions?.["2"], 2),
      "3": normalizeBucket(raw?.dimensions?.["3"], 3),
      "4": normalizeBucket(raw?.dimensions?.["4"], 4),
    },
  };
}

export function normalizeDiagnosticResult(raw: unknown): DiagnosticResult {
  const base = defaultDiagnosticResult();
  if (!raw || typeof raw !== "object") return base;

  const dimensions = Array.isArray((raw as any)?.dimensions)
    ? (raw as any).dimensions
        .map((d: any) => ({
          dimension: Number(d?.dimension ?? 0),
          name: String(d?.name ?? "").trim(),
          coverage_score: Number(d?.coverage_score ?? 0),
          constats_cles: Array.isArray(d?.constats_cles)
            ? d.constats_cles.map(String).filter(Boolean).slice(0, 3)
            : [],
          cause_racine: String(d?.cause_racine ?? "").trim(),
          zones_non_pilotees: Array.isArray(d?.zones_non_pilotees)
            ? d.zones_non_pilotees.map(String).filter(Boolean).slice(0, 6)
            : [],
          validated_findings: Array.isArray(d?.validated_findings)
            ? d.validated_findings.map(String).filter(Boolean).slice(0, 8)
            : [],
          evidences: Array.isArray(d?.evidences)
            ? d.evidences.map(String).filter(Boolean).slice(0, 8)
            : [],
          signals: Array.isArray(d?.signals)
            ? d.signals.map(String).filter(Boolean).slice(0, 8)
            : [],
          open_hypotheses: Array.isArray(d?.open_hypotheses)
            ? d.open_hypotheses.map(String).filter(Boolean).slice(0, 8)
            : [],
        }))
        .filter((d: DiagnosticDimensionResult) =>
          [1, 2, 3, 4].includes(d.dimension)
        )
    : [];

  return {
    synthesis: String((raw as any)?.synthesis ?? base.synthesis).trim(),
    dimensions,
    transformation_priorities: Array.isArray(
      (raw as any)?.transformation_priorities
    )
      ? (raw as any).transformation_priorities
          .map(String)
          .filter(Boolean)
          .slice(0, 8)
      : [],
    objectives: normalizeFinalObjectives((raw as any)?.objectives),
  };
}

export function uniquePush(target: string[], values: string[]) {
  for (const value of values) {
    const x = String(value || "").trim();
    if (x && !target.includes(x)) target.push(x);
  }
}

export function limitUnique(values: string[], max = 8) {
  const out: string[] = [];
  for (const value of values) {
    const x = String(value || "").trim();
    if (x && !out.includes(x)) out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

function uniqueAngles(values: SignalAngle[], max = 8): SignalAngle[] {
  const out: SignalAngle[] = [];
  for (const value of values) {
    if (!out.includes(value)) out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

export function hashQuestion(
  q: Pick<
    FactBackedQuestion,
    "fact_id" | "constat" | "risque_managerial" | "question"
  >
) {
  return `${q.fact_id}|${normalizeText(q.constat)}|${normalizeText(
    q.risque_managerial
  )}|${normalizeText(q.question)}`;
}

export function isAbstractThemeOnly(theme: string, text: string) {
  const t = normalizeTheme(theme);
  const x = normalizeText(text);

  if (!x) return true;

  const vaguePatterns = [
    `point a clarifier sur ${t}`,
    `point a objectiver sur ${t}`,
    `point a instruire sur ${t}`,
    `enjeu sur ${t}`,
    `sujet sur ${t}`,
    `theme ${t}`,
    `"${t}"`,
  ];

  if (vaguePatterns.some((p) => x.includes(p))) return true;
  return x === t || x === `sur ${t}` || x === `point ${t}` || x.length < 20;
}

export function isWeakManagerialRisk(text: string) {
  const x = normalizeText(text);
  if (!x || x.length < 25) return true;

  const banned = [
    "si ce point se confirme il peut avoir un impact direct",
    "peut avoir un impact direct sur la performance",
    "peut limiter la capacite de pilotage",
    "point a clarifier",
    "sujet a objectiver",
    "enjeu sur",
  ];

  return banned.some((p) => x.includes(p));
}

export function isConcreteQuestion(text: string) {
  const x = normalizeText(text);
  if (!x || x.length < 25) return false;

  const abstractPatterns = [
    "point a clarifier",
    "sujet a objectiver",
    "enjeu sur",
    "pouvez vous decrire la situation suivante",
    "ordre de grandeur precis concernant",
    "point le moins maitrise",
  ];
  if (abstractPatterns.some((p) => x.includes(p))) return false;

  const concreteMarkers = [
    "combien",
    "quel ordre de grandeur",
    "sur combien",
    "quels exemples",
    "donnez moi un exemple",
    "qu est ce qui se passe",
    "qui decide",
    "a quelle frequence",
    "sur quels sujets",
    "quand",
    "qui tranche",
    "qu est ce qui explique",
    "dans quels cas",
    "sur quelle periode",
    "quel cas recent",
    "pouvez-vous citer",
    "pouvez vous citer",
    "quel impact",
    "quelle part",
    "qu est ce qui empeche",
    "sur quels dossiers",
    "sur quelles affaires",
  ];

  return concreteMarkers.some((m) => x.includes(m));
}

export function factUsableForQuestion(fact: DiagnosticFact) {
  if (!fact) return false;
  if (fact.reasoning_status === "refuted") return false;
  if (fact.reasoning_status === "contradicted") return false;

  const statement = getDiagnosticStatementFromFact(fact);
  const sourceExcerpt = String(fact.source_excerpt || "").trim();

  if (!statement || statement.length < 20) return false;
  if (isAbstractThemeOnly(fact.theme, statement)) return false;

  const hasSource = sourceExcerpt.length >= 20;
  const hasNumbers = hasNumericValues(fact);
  const hasQuestions = getSuggestedQuestionsFromFact(fact).length > 0;

  return hasSource || hasNumbers || hasQuestions || statement.length >= 60;
}

export function deriveQuestionIntent(
  question: string,
  theme: string,
  iteration: number
): string {
  const q = normalizeText(question);
  const t = normalizeTheme(theme);

  if (
    q.includes("ordre de grandeur") ||
    q.includes("combien") ||
    q.includes("sur combien")
  ) {
    return `${t}|quantification`;
  }
  if (
    q.includes("qui decide") ||
    q.includes("qui arbitre") ||
    q.includes("qui tranche")
  ) {
    return `${t}|decision_rights`;
  }
  if (
    q.includes("a quelle frequence") ||
    q.includes("quand") ||
    q.includes("sur quelle periode")
  ) {
    return `${t}|frequency_timing`;
  }
  if (
    q.includes("donnez moi un exemple") ||
    q.includes("quels exemples") ||
    q.includes("dans quels cas") ||
    q.includes("quel cas recent") ||
    q.includes("pouvez vous me raconter")
  ) {
    return `${t}|examples_cases`;
  }
  if (
    q.includes("qu est ce qui explique") ||
    q.includes("cause") ||
    q.includes("pourquoi")
  ) {
    return `${t}|cause_explanation`;
  }
  if (
    q.includes("qu est ce qui se passe") ||
    q.includes("comment cela se passe") ||
    q.includes("dans la pratique")
  ) {
    return `${t}|real_life_mechanism`;
  }

  if (iteration === 1) return `${t}|initial_understanding`;
  if (iteration === 2) return `${t}|deepening`;
  return `${t}|root_cause`;
}

export function formatIntentMemory(intent: string) {
  return `${INTENT_PREFIX}${intent}`;
}

export function extractIntentMemory(values: string[]): string[] {
  return values
    .filter((value) => String(value || "").startsWith(INTENT_PREFIX))
    .map((value) => String(value).slice(INTENT_PREFIX.length).trim())
    .filter(Boolean);
}

function desiredAnglesForIteration(
  iteration: number,
  mode: IterationMode
): SignalAngle[] {
  if (mode === "reopen_after_no") {
    return ["mechanism", "dependency", "arbitration"];
  }
  if (iteration === 1) return DEFAULT_ITERATION_1_ANGLES;
  if (iteration === 2) return DEFAULT_ITERATION_2_ANGLES;
  return DEFAULT_ITERATION_3_ANGLES;
}

function scoreFactForCoverageGap(
  fact: DiagnosticFact,
  iteration: number,
  mode: IterationMode
): number {
  const askedAngles = fact.asked_angles ?? [];
  const missingAngles = fact.missing_angles ?? [];
  const desiredAngles = desiredAnglesForIteration(iteration, mode);
  const progress = fact.progress ?? "identified";

  let score = 0;

  for (const angle of desiredAngles) {
    if (missingAngles.includes(angle)) score += 18;
    else if (!askedAngles.includes(angle)) score += 8;
  }

  if (progress === "identified") score += 22;
  if (progress === "questioned") score += 16;
  if (progress === "illustrated" && iteration >= 2) score += 12;
  if (progress === "quantified" && iteration >= 2) score += 8;
  if (progress === "causalized" && iteration >= 3) score += 10;
  if (progress === "arbitrated" && iteration >= 3) score += 6;
  if (progress === "stabilized") score -= 14;
  if (progress === "consolidated") score -= 24;

  return score;
}

function scoreDimensionOneStructurality(fact: DiagnosticFact): number {
  if (fact.dimension_primary !== 1) return 0;

  const theme = normalizeTheme(fact.theme);
  const signalKind = getSignalKindFromFact(fact);
  const raw = normalizeText(getDiagnosticStatementFromFact(fact));

  let score = 0;

  if (
    theme.includes("gouvernance") ||
    theme.includes("roles et responsabilites") ||
    theme.includes("ligne manageriale") ||
    theme.includes("relais d encadrement") ||
    theme.includes("competences critiques") ||
    theme.includes("dependances humaines") ||
    theme.includes("structure de pilotage") ||
    theme.includes("autonomie encadrement")
  ) {
    score += 18;
  }

  if (
    signalKind.includes("managerial") ||
    signalKind.includes("dependency") ||
    signalKind.includes("centralization") ||
    signalKind.includes("critical_skill")
  ) {
    score += 12;
  }

  if (
    raw.includes("dirigeant") ||
    raw.includes("remonte") ||
    raw.includes("arbitrage") ||
    raw.includes("absence") ||
    raw.includes("depend") ||
    raw.includes("autonomie") ||
    raw.includes("responsable") ||
    raw.includes("chef d agence")
  ) {
    score += 8;
  }

  return score;
}

function scoreFactForSelection(
  fact: DiagnosticFact,
  bucket: CoverageBucket,
  iteration: number,
  mode: IterationMode
): number {
  const confidence = Number(fact.confidence_score || 0);
  const criticality = Number(fact.criticality_score || 0);
  const askedCount = Number(fact.asked_count || 0);
  const themeKey = normalizeTheme(fact.theme);

  let score = criticality + (100 - confidence) - askedCount * 18;

  if (hasNumericValues(fact)) score += 35;

  if (String(fact.source_excerpt || "").trim().length >= 40) {
    score += 25;
  }

  if (getSuggestedQuestionsFromFact(fact).length > 0) {
    score += 25;
  }

  const diagnosticStatement = getDiagnosticStatementFromFact(fact);
  if (diagnosticStatement.length >= 80) {
    score += 15;
  }

  if (iteration >= 2 && hasConversationMemory(fact)) {
    score += 35;
  }

  if (iteration >= 3 && hasConversationMemory(fact)) {
    score += 20;
  }

  if (iteration === 1 && askedCount === 0) score += 24;
  if (iteration === 2 && askedCount <= 1) score += 18;
  if (iteration === 3 && askedCount <= 2) score += 8;

  if (bucket.critical_uncovered_themes.map(normalizeTheme).includes(themeKey)) {
    score += 18;
  }

  if (bucket.planned_themes.map(normalizeTheme).includes(themeKey)) {
    score += 10;
  }

  if ((bucket.targeted_fact_ids ?? []).includes(fact.id)) {
    score -= 6;
  }

  score += scoreDimensionOneStructurality(fact);
  score += scoreFactForCoverageGap(fact, iteration, mode);

  return score;
}

export function computeCriticalUncoveredThemes(
  coverage: CoverageState,
  dimension: number
): string[] {
  const d = clampDimension(dimension);
  const guard = DIMENSION_GUARDRAILS[d];
  const bucket = coverage.dimensions[toDimensionKey(d)] ?? defaultBucket(d);
  const brief =
    coverage.global_analysis?.dimension_briefs?.[toDimensionKey(d)] ??
    emptyDimensionBrief();

  const covered = new Set(bucket.coveredThemes.map(normalizeTheme));
  const resolved = new Set(
    Object.entries(bucket.theme_status)
      .filter(([, status]) => status === "resolved")
      .map(([theme]) => normalizeTheme(theme))
  );

  const weighted = new Map<string, number>();

  for (const theme of guard.allowedThemes) {
    const key = normalizeTheme(theme);
    if (resolved.has(key)) continue;

    let score = 10;
    if (!covered.has(key)) score += 35;
    if (bucket.theme_status[key] === "unseen") score += 15;
    if (bucket.theme_status[key] === "exploring") score += 5;

    const signalsText = [
      ...bucket.signals,
      ...bucket.open_hypotheses,
      ...bucket.contradictions,
      ...brief.priority_themes,
      ...brief.likely_hypotheses,
      ...brief.risky_signals,
    ]
      .join(" | ")
      .toLowerCase();

    if (signalsText.includes(key)) score += 25;

    if (
      d === 1 &&
      (key.includes("gouvernance") ||
        key.includes("roles") ||
        key.includes("ligne manageriale") ||
        key.includes("competences critiques") ||
        key.includes("dependances humaines") ||
        key.includes("structure de pilotage") ||
        key.includes("autonomie encadrement"))
    ) {
      score += 12;
    }

    weighted.set(theme, score);
  }

  return [...weighted.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([theme]) => theme)
    .slice(0, 8);
}

function refreshFactDerivedState(fact: DiagnosticFact): DiagnosticFact {
  const progress = fact.progress ?? "identified";
  const askedAngles = uniqueAngles(fact.asked_angles ?? [], 8);
  const defaults = defaultAnglesForFact(fact);
  const existingMissing = uniqueAngles(fact.missing_angles ?? [], 8);
  const missing =
    existingMissing.length > 0
      ? existingMissing.filter((angle) => !askedAngles.includes(angle))
      : buildMissingAngles(progress, askedAngles, defaults);

  return {
    ...fact,
    asked_angles: askedAngles,
    missing_angles: missing,
    progress,
  };
}

export function refreshDimensionMemory(
  coverage: CoverageState,
  dimension: number
): CoverageState {
  const next = normalizeCoverage(coverage);
  const bucket = next.dimensions[toDimensionKey(dimension)];
  const criticalUncovered = computeCriticalUncoveredThemes(next, dimension);

  next.fact_inventory = next.fact_inventory.map((fact) =>
    fact.dimension_primary === dimension ? refreshFactDerivedState(fact) : fact
  );

  const unresolvedFactIds = next.fact_inventory
    .filter(
      (f) =>
        f.dimension_primary === dimension &&
        f.reasoning_status !== "refuted" &&
        f.reasoning_status !== "contradicted" &&
        f.progress !== "stabilized" &&
        f.progress !== "consolidated"
    )
    .map((f) => f.id);

  const recentAngles = uniqueAngles(
    [
      ...(bucket.recent_angles ?? []),
      ...normalizeAngleArray(bucket.last_best_angles),
    ],
    8
  );

  const plannedAngles = uniqueAngles(
    [
      ...desiredAnglesForIteration(1, "normal"),
      ...desiredAnglesForIteration(2, "normal"),
      ...desiredAnglesForIteration(3, "normal"),
    ],
    8
  );

  bucket.critical_uncovered_themes = criticalUncovered;
  bucket.planned_themes = limitUnique(
    [
      ...criticalUncovered,
      ...bucket.open_hypotheses,
      ...bucket.contradictions,
      ...bucket.signals,
    ],
    8
  );

  bucket.last_best_angles = limitUnique(bucket.last_best_angles, 6);
  bucket.validations = limitUnique(bucket.validations, 40);
  bucket.unresolved_fact_ids = limitUnique(unresolvedFactIds, 50);
  bucket.recent_angles = recentAngles;
  bucket.planned_angles = plannedAngles;

  return next;
}

export function selectFactsForIteration(
  coverage: CoverageState,
  dimension: number,
  iteration: number,
  mode: IterationMode = "normal"
): DiagnosticFact[] {
  const bucket =
    coverage.dimensions[toDimensionKey(dimension)] ?? defaultBucket(dimension);
  const inventory = coverage.fact_inventory;

  const dimensionFacts = inventory.filter((f) => f.dimension_primary === dimension);
  const usableFacts = dimensionFacts.filter(factUsableForQuestion);

  const unresolvedFacts = usableFacts.filter(
    (f) =>
      f.reasoning_status !== "refuted" &&
      f.reasoning_status !== "contradicted" &&
      f.progress !== "consolidated"
  );

  const alreadyTargeted = new Set(bucket.targeted_fact_ids ?? []);

  function sortFacts(facts: DiagnosticFact[]) {
    return [...facts].sort(
      (a, b) =>
        scoreFactForSelection(b, bucket, iteration, mode) -
        scoreFactForSelection(a, bucket, iteration, mode)
    );
  }

  if (mode === "reopen_after_no") {
    return sortFacts(unresolvedFacts).slice(0, 10);
  }

  const freshFacts = unresolvedFacts.filter((f) => !alreadyTargeted.has(f.id));
  const recycledFacts = unresolvedFacts.filter((f) => alreadyTargeted.has(f.id));

  return [...sortFacts(freshFacts), ...sortFacts(recycledFacts)].slice(0, 10);
}

export function updateFactAskedCounter(
  coverage: CoverageState,
  batch: FactBackedQuestion[]
) {
  for (const q of batch) {
    const fact = coverage.fact_inventory.find((f) => f.id === q.fact_id);
    if (!fact) continue;

    fact.asked_count = (fact.asked_count || 0) + 1;
    fact.last_question_at = new Date().toISOString();

    if (q.intended_angle) {
      fact.last_planned_angle = q.intended_angle;
    }
  }
}

export function updateCoverageAfterBatch(
  coverage: CoverageState,
  dimension: number,
  iteration: number,
  batch: FactBackedQuestion[]
) {
  const bucket = coverage.dimensions[toDimensionKey(dimension)];
  const recentAngles: SignalAngle[] = [...(bucket.recent_angles ?? [])];

  for (const q of batch) {
    uniquePush(bucket.asked, [q.question]);

    if (!bucket.targeted_fact_ids.includes(q.fact_id)) {
      bucket.targeted_fact_ids.push(q.fact_id);
    }

    uniquePush(bucket.validations, [
      formatIntentMemory(deriveQuestionIntent(q.question, q.theme, iteration)),
    ]);

    if (q.intended_angle) {
      recentAngles.push(q.intended_angle);
    }
  }

  bucket.planned_themes = limitUnique(batch.map((q) => q.theme), 8);
  bucket.recent_angles = uniqueAngles(recentAngles, 8);
}

export function buildAnalysisFallback(): AnalysisStep {
  return {
    new_signals: [],
    new_evidences: [],
    validated_findings: [],
    open_hypotheses: [],
    resolved_topics: [],
    contradictions: [],
    covered_themes: [],
    theme_status_updates: [],
    next_best_angle: "",
    confidence_score: 0,
    covered_angles: [],
    signal_updates: [],
  };
}

function inferAnglesFromAnalysis(analysis: AnalysisStep): SignalAngle[] {
  const values = [
    analysis.next_best_angle,
    ...(analysis.covered_angles ?? []),
    ...analysis.new_evidences,
    ...analysis.validated_findings,
    ...analysis.open_hypotheses,
  ];

  const out: SignalAngle[] = [];

  for (const value of values) {
    const angle = normalizeAngle(String(value ?? ""));
    if (angle && !out.includes(angle)) out.push(angle);
  }

  const joined = normalizeText(values.join(" | "));

  if (joined.includes("ordre de grandeur") || joined.includes("combien")) {
    out.push("magnitude");
  }
  if (joined.includes("mecanisme")) {
    out.push("mechanism");
  }
  if (joined.includes("cause")) {
    out.push("causality");
  }
  if (joined.includes("dependance")) {
    out.push("dependency");
  }
  if (joined.includes("arbitrage") || joined.includes("qui decide")) {
    out.push("arbitration");
  }

  return uniqueAngles(out, 6);
}

function progressAfterAnalysis(
  current: SignalProgress | undefined,
  analysis: AnalysisStep
): SignalProgress {
  const progress = current ?? "identified";
  const coveredAngles = inferAnglesFromAnalysis(analysis);

  if (
    analysis.validated_findings.length > 0 &&
    coveredAngles.includes("causality") &&
    coveredAngles.includes("arbitration")
  ) {
    return "stabilized";
  }

  if (coveredAngles.includes("arbitration")) return "arbitrated";
  if (coveredAngles.includes("causality")) return "causalized";
  if (coveredAngles.includes("magnitude")) return "quantified";

  if (
    analysis.new_evidences.length > 0 ||
    coveredAngles.includes("example") ||
    coveredAngles.includes("mechanism") ||
    coveredAngles.includes("formalization")
  ) {
    return "illustrated";
  }

  if (progress === "identified") return "questioned";
  return progress;
}

export function updateCoverageWithAnalysis(
  coverage: CoverageState,
  dimension: number,
  analysis: AnalysisStep
): CoverageState {
  const next = normalizeCoverage(coverage);
  const bucket = next.dimensions[toDimensionKey(dimension)];

  uniquePush(bucket.learned_facts, [...analysis.new_signals, ...analysis.new_evidences]);
  uniquePush(bucket.signals, analysis.new_signals);
  uniquePush(bucket.evidences, analysis.new_evidences);
  uniquePush(bucket.validated_findings, analysis.validated_findings);
  uniquePush(bucket.open_hypotheses, analysis.open_hypotheses);
  uniquePush(bucket.resolved_topics, analysis.resolved_topics);
  uniquePush(bucket.contradictions, analysis.contradictions);
  uniquePush(bucket.coveredThemes, analysis.covered_themes.map(normalizeTheme));

  for (const update of analysis.theme_status_updates) {
    const themeKey = normalizeTheme(update.theme);
    if (!bucket.theme_status[themeKey]) continue;
    bucket.theme_status[themeKey] = update.status;
  }

  if (analysis.next_best_angle) {
    uniquePush(bucket.last_best_angles, [analysis.next_best_angle]);
  }

  const coveredAngles = inferAnglesFromAnalysis(analysis);
  bucket.recent_angles = uniqueAngles(
    [...(bucket.recent_angles ?? []), ...coveredAngles],
    8
  );

  if (Array.isArray(analysis.signal_updates) && analysis.signal_updates.length > 0) {
    for (const update of analysis.signal_updates) {
      const fact = next.fact_inventory.find((f) => f.id === update.fact_id);
      if (!fact) continue;

      if (update.progress) {
        fact.progress = update.progress;
      } else {
        fact.progress = progressAfterAnalysis(fact.progress, analysis);
      }

      const newlyCovered = Array.isArray(update.newly_covered_angles)
        ? update.newly_covered_angles
        : [];

      fact.asked_angles = uniqueAngles(
        [...(fact.asked_angles ?? []), ...newlyCovered],
        8
      );

      if (
        Array.isArray(update.remaining_angles) &&
        update.remaining_angles.length > 0
      ) {
        fact.missing_angles = uniqueAngles(update.remaining_angles, 8);
      } else {
        fact.missing_angles = buildMissingAngles(
          fact.progress ?? "identified",
          fact.asked_angles ?? [],
          defaultAnglesForFact(fact)
        );
      }
    }
  }

  bucket.sufficiency_score = Math.min(
    100,
    Math.max(
      0,
      bucket.validated_findings.length * 15 +
        bucket.evidences.length * 10 +
        bucket.coveredThemes.length * 5 -
        bucket.contradictions.length * 5
    )
  );

  return refreshDimensionMemory(next, dimension);
}

export async function ensureGlobalAnalysis(
  coverage: CoverageState,
  extractedText: string
): Promise<CoverageState> {
  if (coverage.global_analysis) return coverage;

  return {
    ...coverage,
    global_analysis: {
      ...defaultGlobalAnalysis(),
      summary:
        extractedText.replace(/\s+/g, " ").trim().slice(0, 1200) ||
        defaultGlobalAnalysis().summary,
    },
  };
}

function buildFactConstatPrefix(mode: StatementMode): string {
  if (mode === "validated_finding") return "Constat";
  if (mode === "prudent_hypothesis") return "Observation prudente";
  return "Point à clarifier";
}

export function buildConstatFromFact(fact: DiagnosticFact): string {
  const prefix = buildFactConstatPrefix(fact.allowed_statement_mode);

  const base =
    getDiagnosticStatementFromFact(fact) ||
    getRawSignalFromFact(fact) ||
    fact.source_excerpt ||
    fact.observed_element.trim();

  return `${prefix} : ${base}`.replace(/\s+/g, " ").trim();
}

export function buildRiskFromFact(fact: DiagnosticFact): string {
  if (fact.managerial_risk && fact.managerial_risk.length > 20) {
    return fact.managerial_risk.replace(/\s+/g, " ").trim();
  }

  const statement = getDiagnosticStatementFromFact(fact);

  if (statement.length > 60 && hasNumericValues(fact)) {
    return "Ce point peut fausser la lecture de la performance réelle et conduire à des arbitrages opérationnels ou commerciaux mal calibrés.";
  }

  const theme = normalizeTheme(fact.theme);

  if (theme.includes("gouvernance") || theme.includes("autonomie encadrement")) {
    return "Si les décisions restent trop concentrées au niveau du dirigeant, l'organisation restera lente à arbitrer et fragile face aux aléas.";
  }

  if (
    theme.includes("roles et responsabilites") ||
    theme.includes("ligne manageriale") ||
    theme.includes("relais d encadrement")
  ) {
    return "Si les rôles et les relais d'encadrement restent fragiles, le dirigeant continuera à compenser ce que la ligne managériale n'absorbe pas.";
  }

  if (
    theme.includes("competences critiques") ||
    theme.includes("dependances humaines")
  ) {
    return "Une dépendance forte à quelques personnes clés peut fragiliser directement la continuité d'exécution et ralentir tout redressement.";
  }

  if (theme.includes("recrutement")) {
    return "Des recrutements mal cadrés peuvent prolonger les fragilités d'encadrement et alourdir durablement la charge de reprise managériale.";
  }

  if (theme.includes("climat social") || theme.includes("adhesion des equipes")) {
    return "Si ce point n'est pas traité, l'adhésion peut rester fragile et peser progressivement sur l'exécution et la stabilité des équipes.";
  }

  if (
    theme.includes("rituels manageriaux") ||
    theme.includes("structure de pilotage")
  ) {
    return "Sans rituels solides, le pilotage reste dépendant des personnes et les dérives sont détectées trop tard.";
  }

  if (
    theme.includes("organisation interne") ||
    theme.includes("dimensionnement structure")
  ) {
    return "Si la structure reste mal ajustée à la charge réelle, l'organisation continuera à compenser au lieu d'absorber durablement.";
  }

  return "Sans qualification plus précise de ce point, le diagnostic risque de rester trop général et de mal hiérarchiser les priorités de transformation.";
}

function pickBestMissingAngle(
  fact: DiagnosticFact,
  iteration: number,
  mode: IterationMode = "normal"
): SignalAngle {
  const desired = desiredAnglesForIteration(iteration, mode);
  const missing = fact.missing_angles ?? [];
  const asked = fact.asked_angles ?? [];

  for (const angle of desired) {
    if (missing.includes(angle)) return angle;
  }

  for (const angle of missing) {
    if (!asked.includes(angle)) return angle;
  }

  if (desired.length > 0) return desired[0];
  return "mechanism";
}

export function buildQuestionFromFact(
  fact: DiagnosticFact,
  iteration = 1,
  mode: IterationMode = "normal"
): string {
  const suggestedQuestions = getSuggestedQuestionsFromFact(fact);

  if (suggestedQuestions.length > 0) {
    const candidate = suggestedQuestions.find((q) => {
      const normalized = normalizeText(q);
      if (!normalized || normalized.length < 25) return false;
      return !normalized.includes("point le moins maitrise");
    });

    if (candidate) return candidate;
  }

  const element =
    getDiagnosticStatementFromFact(fact) ||
    getRawSignalFromFact(fact) ||
    fact.observed_element.trim();

  const angle = pickBestMissingAngle(fact, iteration, mode);

  const numericContext = hasNumericValues(fact)
    ? " en vous appuyant sur les chiffres disponibles"
    : "";

  switch (angle) {
    case "example":
      return `Pouvez-vous me donner un cas concret qui illustre ce point : ${element} ?`;
    case "magnitude":
      return `Quel ordre de grandeur récent permet de mesurer ce point${numericContext} : ${element} ?`;
    case "mechanism":
      return `Concrètement, comment ce point se produit-il dans le fonctionnement quotidien : ${element} ?`;
    case "causality":
      return `Quelle est selon vous la cause principale de cette situation : ${element} ?`;
    case "dependency":
      return `Cette situation dépend-elle d’une personne, d’un outil ou d’une pratique qui n’est pas suffisamment sécurisée : ${element} ?`;
    case "arbitration":
      return `Quand ce point apparaît, qui tranche réellement et sur quels critères : ${element} ?`;
    case "formalization":
      return `Qu’est-ce qui est formalisé aujourd’hui sur ce point, et qu’est-ce qui reste traité par habitude : ${element} ?`;
    case "transition":
      return `Qu’est-ce qui empêche aujourd’hui de passer à un fonctionnement plus robuste sur ce point : ${element} ?`;
    case "economics":
      return `Quel impact ce point a-t-il aujourd’hui sur la marge, la charge ou la performance réelle : ${element} ?`;
    case "frequency":
      return `À quelle fréquence ce point se produit-il réellement, et sur quels périmètres : ${element} ?`;
    case "feedback":
      return `Quand ce point est constaté, comment est-il analysé et corrigé ensuite : ${element} ?`;
    default:
      return `Pouvez-vous préciser concrètement ce point dans le fonctionnement réel : ${element} ?`;
  }
}

export function fallbackFactsFromThemes(
  dimension: number,
  extractedText: string
): DiagnosticFact[] {
  const d = clampDimension(dimension);
  const excerpt = extractedText.replace(/\s+/g, " ").trim().slice(0, 700);

  return DIMENSION_GUARDRAILS[d].allowedThemes.slice(0, 6).map((theme, idx) => {
    const proofLevel = 2;
    const fact: DiagnosticFact = {
      id: `fallback-d${d}-${idx + 1}`,
      dimension_primary: d as FactDimension,
      dimension_secondary: [],
      fact_type: factTypeForDimension(d) as FactType,
      theme,
      observed_element: `La trame ne documente pas encore concrètement le fonctionnement réel sur le thème "${theme}".`,
      source: "trame",
      source_excerpt: excerpt,
      numeric_values: {},
      tags: [normalizeTheme(theme)],
      evidence_kind: "weak_signal",
      proof_level: proofLevel,
      reasoning_status: "to_instruct",
      prudent_hypothesis: `Le thème "${theme}" reste insuffisamment documenté à ce stade.`,
      managerial_risk:
        "Si ce point reste mal documenté, le dirigeant peut garder un angle mort sur un levier de pilotage structurant.",
      instruction_goal: "verify",
      allowed_statement_mode: inferAllowedStatementMode(proofLevel),
      confidence_score: 25,
      criticality_score: 25,
      asked_count: 0,
      last_question_at: undefined,
      evidence_refs: [],
      contradiction_notes: [],
      progress: "identified",
      asked_angles: [],
      missing_angles: ["mechanism", "formalization", "dependency"],
      last_planned_angle: undefined,
      first_seen_iteration: 1,
      last_completed_iteration: undefined,
      linked_fact_ids: [],
      previous_questions: [],
      previous_answers: [],
      answer_summaries: [],
      validated_findings: [],
      open_hypotheses: [],
      next_question_hints: [],
    };
    return fact;
  });
}

export function computeDiagnosticSynthesis(
  diagnosticResult: DiagnosticResult,
  globalAnalysis: GlobalTrameAnalysis | null
): string {
  if (diagnosticResult?.synthesis?.trim()) {
    return diagnosticResult.synthesis.trim();
  }
  if (globalAnalysis?.summary?.trim()) {
    return globalAnalysis.summary.trim();
  }
  return "Le diagnostic global est en cours de structuration.";
}