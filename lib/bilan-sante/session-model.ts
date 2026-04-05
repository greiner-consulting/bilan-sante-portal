export type DimensionId =
  | "organisation"
  | "commerce"
  | "production"
  | "financier";

export type IterationNumber = 1 | 2 | 3;

export type EvidenceStrength = "strong" | "medium" | "weak";

export type SignalOrigin = "trame" | "dirigeant_memory";

export type FactType =
  | "current_state"
  | "difficulty"
  | "tension"
  | "dependency"
  | "capacity"
  | "threshold"
  | "future_need"
  | "commercial_gap"
  | "organizational_point"
  | "unstructured_practice"
  | "positive_point"
  | "clarification"
  | "arbitration"
  | "trigger"
  | "lack_of_formalization";

export type InvestigationObjectStatus =
  | "new"
  | "in_progress"
  | "sufficiently_explored"
  | "closed";

export type QuestionIntent =
  | "open_core"
  | "clarify_mechanism"
  | "identify_threshold"
  | "test_formalization"
  | "identify_dependency"
  | "test_anticipation"
  | "confirm_strength"
  | "validate_priority";

export type EnginePhase =
  | "awaiting_trame"
  | "dimension_iteration"
  | "iteration_validation"
  | "final_review"
  | "report_ready";

export type IterationValidationDecision = "validate" | "reopen";

export interface SourceReference {
  sectionId: string;
  sectionTitle?: string;
  excerptExact: string;
}

export interface DiagnosticSignal {
  id: string;
  dimensionId: DimensionId;
  sourceOrigin: SignalOrigin;
  linkedTurnId?: string;
  source: SourceReference;
  factAtomic: string;
  factType: FactType;
  themeCandidates: string[];
  objectCandidate: string;
  evidenceStrength: EvidenceStrength;
  tags?: string[];
}

export interface DriverMemorySignal extends DiagnosticSignal {
  sourceOrigin: "dirigeant_memory";
  linkedTurnId: string;
}

export interface InvestigationObject {
  id: string;
  dimensionId: DimensionId;
  label: string;
  canonicalKey: string;
  supportingSignalIds: string[];
  supportSummary: string;
  evidenceStrength: EvidenceStrength;
  status: InvestigationObjectStatus;
  coveredInIterations: IterationNumber[];
  explorationAxes: string[];
}

export interface StructuredQuestion {
  id: string;
  dimensionId: DimensionId;
  iteration: IterationNumber;
  objectId: string;
  objectLabel: string;
  supportSignalIds: string[];
  supportFacts: string[];
  questionIntent: QuestionIntent;
  questionText: string;
  askedBecause: string;
}

export interface DriverAnswer {
  questionId: string;
  dimensionId: DimensionId;
  iteration: IterationNumber;
  answerText: string;
}

export interface QuestionBatch {
  dimensionId: DimensionId;
  iteration: IterationNumber;
  questions: StructuredQuestion[];
}

export interface IterationCoverage {
  dimensionId: DimensionId;
  iteration: IterationNumber;
  targetCount: number;
  minimumCount: number;
  actualCount: number;
  weakMatterMode: boolean;
}

export interface IterationValidationTrace {
  dimensionId: DimensionId;
  iteration: IterationNumber;
  decision: IterationValidationDecision;
  note?: string;
  decidedAt: string;
}

export interface FrozenIterationSummary {
  iteration: IterationNumber;
  questionIds: string[];
  exploredObjectIds: string[];
  summary: string;
}

export interface FrozenDimensionSnapshot {
  dimensionId: DimensionId;
  frozenAt: string;
  iterationSummaries: FrozenIterationSummary[];
  salientSignalIds: string[];
  retainedObjectIds: string[];
  keyFindings: string[];
  nonPilotedAreas: string[];
  driverValidationNote?: string;
}

export interface ActiveIterationState {
  dimensionId: DimensionId;
  iteration: IterationNumber;
  selectedObjectIds: string[];
  questionBatch: QuestionBatch;
  openedAt: string;
  closureRequestedAt?: string;
  validatedAt?: string;
  validationStatus: "in_progress" | "awaiting_validation" | "validated";
}

export interface SignalRegistry {
  signals: DiagnosticSignal[];
  investigationObjects: InvestigationObject[];
}

export interface DiagnosticSessionState {
  sessionId: string;
  protocolVersion: string;

  phase: EnginePhase;

  signals: DiagnosticSignal[];
  investigationObjects: InvestigationObject[];
  questions: StructuredQuestion[];
  answers: DriverAnswer[];
  coverage: IterationCoverage[];

  currentDimensionId: DimensionId | null;
  currentIteration: IterationNumber | null;

  currentBatch: QuestionBatch | null;
  currentIterationState: ActiveIterationState | null;

  frozenDimensions: FrozenDimensionSnapshot[];
  validationHistory: IterationValidationTrace[];

  createdAt: string;
  updatedAt: string;
}

export function isDriverMemorySignal(
  signal: DiagnosticSignal
): signal is DriverMemorySignal {
  return (
    signal.sourceOrigin === "dirigeant_memory" &&
    typeof signal.linkedTurnId === "string" &&
    signal.linkedTurnId.length > 0
  );
}

export function buildSourceReference(input: {
  sectionId: string;
  sectionTitle?: string;
  excerptExact: string;
}): SourceReference {
  return {
    sectionId: input.sectionId,
    sectionTitle: input.sectionTitle,
    excerptExact: input.excerptExact.trim(),
  };
}

export function normalizeFreeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildCanonicalObjectKey(input: {
  dimensionId: DimensionId;
  objectCandidate: string;
}): string {
  return `${input.dimensionId}::${normalizeFreeText(input.objectCandidate)}`;
}

export function getBestEvidenceStrength(
  values: EvidenceStrength[]
): EvidenceStrength {
  if (values.includes("strong")) {
    return "strong";
  }
  if (values.includes("medium")) {
    return "medium";
  }
  return "weak";
}