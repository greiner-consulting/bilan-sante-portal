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
  title?: string;
  sectionNumber?: string;
  qualityFlags?: QualityFlag[];
  missingFields?: MissingFieldHint[];
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
  dimensionBlueprints?: Array<{
    dimensionId: DimensionId;
    label: string;
    detectedSectionIds: string[];
    detectedHeadings: string[];
    isPresent: boolean;
    expressedThemes: string[];
    inferredThemes: string[];
    selectedThemes: string[];
    weakSignalThemes: string[];
  }>;
  structureValidation?: {
    isValid: boolean;
    missingDimensionIds: DimensionId[];
    missingDimensionLabels: string[];
    message: string;
  };
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

export type PlanningDiagnostic = {
  signalId: string;
  theme: string;
  entryAngle: EntryAngle;
  score: number;
  rationale: string[];
};

export type WorksetPlanningDiagnostics = {
  generatedAt: string;
  strategy: string;
  selectedQuestionIds: string[];
  candidateDiagnostics: PlanningDiagnostic[];
  notes: string[];
};

export type WorksetClosureDiagnostics = {
  decidedAt?: string;
  qualityStop: boolean;
  remainingLowValue: boolean;
  uncoveredMandatoryAngles: EntryAngle[];
  highValueRemainderQuestionIds: string[];
  reasonCodes: string[];
  notes: string[];
};

export interface IterationWorkset {
  dimensionId: DimensionId;
  iteration: IterationNumber;
  header: string;
  questions: StructuredQuestion[];
  answers: AnswerRecord[];
  closurePrompt: string;
  closureAskedAt?: string;
  targetQuestionCount: number;
  minimumRequiredCount: number;
  sourceIterationQuestionCount?: number | null;
  planningDiagnostics?: WorksetPlanningDiagnostics | null;
  closureDiagnostics?: WorksetClosureDiagnostics | null;
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

  // lot 4
  objectiveFamily?: string;
  knowledgeActionIds?: string[];
  knowledgeIndicatorIds?: string[];
  quantificationNotes?: string[];
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
  exploredThemes?: string[];
  exploredSignalIds?: string[];
  analysisSnapshot?: DimensionAnalysisSnapshot;
  summary?: string;
  evidenceSummary?: string[];
  facts?: DimensionFact[];
  rootCauseHypotheses?: RootCauseHypothesis[];
  swot?: SwotSnapshot;
  objectiveSeeds?: ObjectiveSeed[];
  keyFindings?: string[];
  nonPilotedAreas?: ZoneNonPilotee[];
  keyFactIds?: string[];
}

export type FinalObjectiveProposalSource =
  | "initial_seed"
  | "alternative_seed"
  | "adjusted_feedback"
  | "fallback";

export interface FinalObjectiveDecisionTrace {
  at: string;
  status: "validated" | "adjusted" | "refused";
  previousLabel: string;
  nextLabel: string;
  previousSourceSeedId?: string | null;
  nextSourceSeedId?: string | null;
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
  proposalRevision?: number;
  sourceSeedId?: string | null;
  proposalSource?: FinalObjectiveProposalSource;
  decisionHistory?: FinalObjectiveDecisionTrace[];
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

export interface IterationHistoryRecord {
  dimensionId: DimensionId;
  iteration: IterationNumber;
  questionCount: number;
  answeredCount: number;
  closedAt?: string;
}

export type ThemeCoverageStatus = "open" | "saturated" | "closed";

export type ThemeCoverageMarkStatus = "asked" | "confirmed" | "rejected";

export type ThemeCoverageMark = {
  angle: EntryAngle;
  iteration: IterationNumber | null;
  questionId: string | null;
  status: ThemeCoverageMarkStatus;
};

export type ThemeCoverageRecord = {
  id: string;
  dimensionId: DimensionId;
  theme: string;
  askedAngles: EntryAngle[];
  confirmedAngles: EntryAngle[];
  rejectedAngles: EntryAngle[];
  askedQuestionIds: string[];
  confirmedQuestionIds: string[];
  lastQuestionId: string | null;
  lastQuestionText: string | null;
  lastIteration: IterationNumber | null;
  factDensity: number;
  closureStatus: ThemeCoverageStatus;
  angleHistory: ThemeCoverageMark[];
  notes: string[];
  updatedAt: string;
};

export type ConversationTurnRole = "assistant" | "user" | "question" | "system";

export type ConversationTurn = {
  id: string;
  createdAt: string;
  role: ConversationTurnRole;
  text: string;
  kind?: string | null;
  phase?: SessionPhase | null;
  dimensionId?: DimensionId | null;
  iteration?: IterationNumber | null;
  questionId?: string | null;
  signalId?: string | null;
  theme?: string | null;
  ordinal?: number | null;
  total?: number | null;
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
  iterationHistory?: IterationHistoryRecord[];
  themeCoverage?: ThemeCoverageRecord[];
  conversationHistory?: ConversationTurn[];
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
    iterationHistory: [],
    themeCoverage: [],
    conversationHistory: [],
  };
}

export function touchSession(
  session: DiagnosticSessionAggregate
): DiagnosticSessionAggregate {
  return {
    ...session,
    updatedAt: new Date().toISOString(),
    analysisMemory: session.analysisMemory ?? [],
    iterationHistory: session.iterationHistory ?? [],
    themeCoverage: session.themeCoverage ?? [],
    conversationHistory: session.conversationHistory ?? [],
  };
}

export function cloneRegistry(registry: SignalRegistry): SignalRegistry {
  return deepClone(registry);
}

export function cloneWorkset(
  workset: IterationWorkset | null
): IterationWorkset | null {
  if (!workset) return null;
  return deepClone(workset);
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