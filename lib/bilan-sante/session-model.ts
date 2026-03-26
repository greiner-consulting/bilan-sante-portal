// lib/bilan-sante/session-model.ts

import type { DimensionId, IterationNumber } from "@/lib/bilan-sante/protocol";

export type SignalKind = "explicit" | "absence";
export type SignalSourceType = "trame" | "user_answer" | "derived";

export type EntryAngle =
  | "causality"
  | "arbitration"
  | "economics"
  | "formalization"
  | "dependency"
  | "mechanism";

export type DimensionFactNature =
  | "fact"
  | "verbatim"
  | "signal"
  | "risk"
  | "strength"
  | "weakness"
  | "opportunity"
  | "threat"
  | "objective"
  | "hypothesis"
  | "cause"
  | "gap"
  | "impact"
  | "practice"
  | "other";

export type InputIntent =
  | "answer"
  | "clarification_request"
  | "challenge"
  | "validation_yes"
  | "validation_no"
  | "objective_feedback"
  | "unknown"
  | "off_topic_or_noise"
  | "iteration_validation_yes"
  | "iteration_validation_no"
  | "question_challenge"
  | "business_answer";

export type QuestionIntent =
  | "exploration"
  | "causality"
  | "impact"
  | "clarification"
  | "reframing"
  | "challenge"
  | "describe_mechanism"
  | "locate_bottleneck"
  | "identify_dependency"
  | "identify_missing_rule"
  | "identify_missing_metric"
  | "clarify_cause"
  | "clarify_arbitration"
  | "test_formalization";

export interface QualityFlag {
  severity: "info" | "warning" | "error";
  level?: "info" | "warning" | "error";
  message: string;
  code?: string;
}

export interface BaseTrameSection {
  id: string;
  heading: string;
  content: string;
}

export interface MissingFieldHint {
  dimensionId: DimensionId;
  label: string;
  sourceText: string;
  field?: string;
  severity?: "low" | "medium" | "high";
  message?: string;
}

export type TrameSection = BaseTrameSection;
export type MissingFieldSignal = MissingFieldHint;

export interface BaseTrameSnapshot {
  sections: BaseTrameSection[];
  missingFields: MissingFieldHint[];
  rawText?: string;
  extractedAt?: string;
  qualityFlags: QualityFlag[];
}

export type BaseTrame = BaseTrameSnapshot;

export interface DiagnosticSignal {
  id: string;
  dimensionId: DimensionId;
  theme: string;
  signalKind: SignalKind;
  sourceType: SignalSourceType;
  sourceSection: string | null;
  sourceSectionId?: string | null;
  sourceExcerpt: string;
  constat: string;
  managerialRisk: string;
  probableConsequence: string;
  entryAngle: EntryAngle;
  confidenceScore: number;
  criticalityScore: number;
}

export interface SignalRegistry {
  all: DiagnosticSignal[];
  allSignals: DiagnosticSignal[];
  byDimension: {
    d1: DiagnosticSignal[];
    d2: DiagnosticSignal[];
    d3: DiagnosticSignal[];
    d4: DiagnosticSignal[];
  };
}

export interface StructuredQuestion {
  id: string;
  signalId: string;
  theme: string;
  constat: string;
  risqueManagerial: string;
  questionOuverte: string;
}

export interface AnswerRecord {
  questionId: string;
  answerText: string;
  answeredAt: string;
}

export interface IterationWorkset {
  dimensionId: DimensionId;
  iteration: IterationNumber;
  header: string;
  questions: StructuredQuestion[];
  answers: AnswerRecord[];
  closurePrompt: string;
  closureAskedAt?: string;
}

export interface DimensionFact {
  id: string;
  theme: string;
  nature: DimensionFactNature;
  statement: string;

  evidence?: string;
  confidence?: number;
  confidenceScore?: number;
  priorityScore?: number;

  sourceQuestionId?: string | null;
  sourceSignalId?: string | null;

  sources?: string[];
  supportingFactIds?: string[];
  tags?: string[];

  quadrant?: "strength" | "weakness" | "opportunity" | "threat";
  label?: string;
  detail?: string;
  rationale?: string;
}

export interface RootCauseHypothesis {
  id?: string;
  label: string;
  rationale: string;

  confidence?: number;
  confidenceScore?: number;

  evidence?: string[];
  supportingFactIds?: string[];
  opposingFactIds?: string[];
}

export interface SwotItem {
  id?: string;
  quadrant?: "strength" | "weakness" | "opportunity" | "threat";
  label: string;
  detail?: string;
  rationale?: string;
  evidence?: string;

  confidence?: number;
  confidenceScore?: number;
  supportingFactIds?: string[];
  priorityScore?: number;
}

export interface SwotSnapshot {
  strengths: SwotItem[];
  weaknesses: SwotItem[];
  opportunities: SwotItem[];
  threats: SwotItem[];
}

export interface ObjectiveSeed {
  id?: string;
  label: string;
  rationale?: string;

  ownerHint?: string;
  indicatorHint?: string;
  priority?: "high" | "medium" | "low";
  dueDateHint?: string;

  indicator?: string;
  suggestedDueDate?: string;
  potentialGain?: string;
  quickWin?: string;
  linkedFactIds?: string[];
  priorityScore?: number;
}

export interface ZoneNonPilotee {
  constat: string;
  risqueManagerial: string;
  consequence: string;
}

export interface DimensionAnalysisSnapshot {
  dimensionId: DimensionId;
  score?: 1 | 2 | 3 | 4 | 5;
  summary: string;
  facts: DimensionFact[];
  rootCauseHypotheses: RootCauseHypothesis[];
  swot: SwotSnapshot;
  objectiveSeeds: ObjectiveSeed[];
  evidenceSummary?: string[];
  keyFindings?: string[];
  nonPilotedAreas?: ZoneNonPilotee[];
  generatedAt?: string;
}

export interface FrozenDimensionDiagnosis {
  dimensionId: DimensionId;
  score: 1 | 2 | 3 | 4 | 5;
  consolidatedFindings: [string, string, string];
  dominantRootCause: string;
  unmanagedZones: ZoneNonPilotee[];
  frozenAt: string;

  // compat consolidation / builder
  summary?: string;
  evidenceSummary?: string[];
  facts?: DimensionFact[];
  rootCauseHypotheses?: RootCauseHypothesis[];
  swot?: SwotSnapshot;
  objectiveSeeds?: ObjectiveSeed[];
  keyFindings?: string[];
  nonPilotedAreas?: ZoneNonPilotee[];
  keyFactIds?: string[];
  analysisSnapshot?: DimensionAnalysisSnapshot;
}

export interface FinalObjective {
  id: string;
  dimensionId: DimensionId;
  objectiveLabel: string;
  owner: string;
  keyIndicator: string;
  dueDate: string;
  potentialGain: string;
  gainHypotheses: string[];
  validationStatus: "proposed" | "validated" | "adjusted" | "refused";
  quickWin: string;
}

export interface FinalObjectiveSet {
  header: string;
  objectives: FinalObjective[];
  decisionsCapturedAt?: string;
}

export type SessionPhase =
  | "awaiting_trame"
  | "dimension_iteration"
  | "iteration_validation"
  | "final_objectives_validation"
  | "report_ready"
  | "completed";

export type MemoryIntent =
  | "business_answer"
  | "reframing"
  | "clarification_request"
  | "challenge"
  | "mixed"
  | "noise";

export type MemoryAction =
  | "store_answer"
  | "store_and_pivot"
  | "rephrase_question"
  | "ask_for_examples"
  | "challenge_same_topic";

export type MemoryRootCauseCategory =
  | "skills"
  | "experience"
  | "decision"
  | "arbitration"
  | "organization"
  | "resources"
  | "pricing"
  | "commercial"
  | "execution"
  | "quality"
  | "cash";

export type MemoryInsight = {
  id: string;
  createdAt: string;
  dimensionId: DimensionId | null;
  iteration: IterationNumber | null;
  questionId: string | null;
  signalId: string | null;
  theme: string | null;

  intent: MemoryIntent;
  action: MemoryAction;
  confidence: number;

  summary: string;
  rationale: string;
  rawMessage: string;

  extractedFacts: string[];
  detectedRootCauses: MemoryRootCauseCategory[];
  reframingSignals: string[];
  contradictionSignals: string[];
  suggestedAngle: EntryAngle | null;

  shouldStoreAsAnswer: boolean;
  shouldRephraseQuestion: boolean;
  shouldPivotAngle: boolean;
  isUsableBusinessMatter: boolean;
};

export interface DiagnosticSessionAggregate {
  sessionId: string;
  phase: SessionPhase;
  trame: BaseTrameSnapshot | null;
  signalRegistry: SignalRegistry | null;
  currentDimensionId: DimensionId | null;
  currentIteration: IterationNumber | null;
  currentWorkset: IterationWorkset | null;
  frozenDimensions: FrozenDimensionDiagnosis[];
  finalObjectives: FinalObjectiveSet | null;
  createdAt: string;
  updatedAt: string;
  analysisMemory?: MemoryInsight[];
}

export function createEmptySessionAggregate(
  sessionId: string
): DiagnosticSessionAggregate {
  const now = new Date().toISOString();

  return {
    sessionId,
    phase: "awaiting_trame",
    trame: null,
    signalRegistry: null,
    currentDimensionId: null,
    currentIteration: null,
    currentWorkset: null,
    frozenDimensions: [],
    finalObjectives: null,
    createdAt: now,
    updatedAt: now,
    analysisMemory: [],
  };
}

export function touchSession(
  session: DiagnosticSessionAggregate
): DiagnosticSessionAggregate {
  return {
    ...session,
    updatedAt: new Date().toISOString(),
    analysisMemory: session.analysisMemory ?? [],
  };
}

export function cloneRegistry(registry: SignalRegistry): SignalRegistry {
  return {
    ...registry,
    all: [...registry.all],
    allSignals: [...registry.allSignals],
    byDimension: {
      d1: [...registry.byDimension.d1],
      d2: [...registry.byDimension.d2],
      d3: [...registry.byDimension.d3],
      d4: [...registry.byDimension.d4],
    },
  };
}

export function cloneWorkset(
  workset: IterationWorkset | null
): IterationWorkset | null {
  if (!workset) return null;

  return {
    ...workset,
    questions: [...workset.questions],
    answers: [...workset.answers],
  };
}

export function answeredQuestionIds(
  workset: IterationWorkset | null | undefined
): Set<string> {
  if (!workset) return new Set<string>();
  return new Set(workset.answers.map((answer) => answer.questionId));
}

export function isWorksetFullyAnswered(workset: IterationWorkset): boolean {
  const answeredIds = answeredQuestionIds(workset);
  return workset.questions.every((question) => answeredIds.has(question.id));
}
