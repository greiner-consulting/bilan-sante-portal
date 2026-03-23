// lib/bilan-sante/session-model.ts

import type {
  DimensionId,
  DimensionKey,
  IterationNumber,
} from "@/lib/bilan-sante/protocol";

export type SessionPhase =
  | "awaiting_trame"
  | "dimension_iteration"
  | "iteration_validation"
  | "final_objectives_validation"
  | "report_ready"
  | "completed";

export type TrameQualityFlag = {
  severity: "info" | "warning" | "critical";
  message: string;
};

export type QualityFlag = TrameQualityFlag;

export type TrameMissingField = {
  label: string;
  sourceText: string;
  dimensionId?: DimensionId | null;
};

export type MissingFieldSignal = TrameMissingField;

export type TrameSection = {
  id: string;
  heading: string;
  content: string;
};

export type BaseTrameSnapshot = {
  rawText: string;
  normalizedText: string;
  sections: TrameSection[];
  tables: unknown[];
  extractedAt: string;
  qualityFlags: TrameQualityFlag[];
  missingFields: TrameMissingField[];
};

export type DiagnosticSignalKind = "explicit" | "absence";

export type SignalEntryAngle =
  | "mechanism"
  | "formalization"
  | "causality"
  | "arbitration"
  | "dependency"
  | "economics"
  | "execution"
  | "market"
  | "pricing"
  | "people";

export type DiagnosticSignal = {
  id: string;
  dimensionId: DimensionId;
  theme: string;
  constat: string;
  managerialRisk: string;
  probableConsequence: string;
  signalKind: DiagnosticSignalKind;
  entryAngle: SignalEntryAngle;
  criticalityScore: number;
  confidenceScore: number;
  sourceType: "trame" | "absence_in_trame";
  sourceSectionId?: string | null;
  sourceExcerpt: string;
};

export type SignalRegistry = {
  byDimension: Record<DimensionKey, DiagnosticSignal[]>;
  allSignals: DiagnosticSignal[];
};

export type StructuredQuestion = {
  id: string;
  signalId: string;
  theme: string;
  constat: string;
  risqueManagerial: string;
  questionOuverte: string;
};

export type AnswerRecord = {
  questionId: string;
  answerText: string;
  answeredAt: string;
};

export type IterationWorkset = {
  dimensionId: DimensionId;
  iteration: IterationNumber;
  header: string;
  questions: StructuredQuestion[];
  answers: AnswerRecord[];
  closurePrompt: string;
  closureAskedAt?: string;
};

export type ZoneNonPilotee = {
  constat: string;
  risqueManagerial: string;
  consequence: string;
};

export type FrozenDimensionDiagnosis = {
  dimensionId: DimensionId;
  score: 1 | 2 | 3 | 4 | 5;
  consolidatedFindings: [string, string, string];
  dominantRootCause: string;
  unmanagedZones: ZoneNonPilotee[];
  frozenAt: string;
};

export type FinalObjectiveValidationStatus =
  | "proposed"
  | "validated"
  | "adjusted"
  | "refused";

export type FinalObjective = {
  id: string;
  dimensionId: DimensionId;
  objectiveLabel: string;
  owner: string;
  keyIndicator: string;
  dueDate: string;
  potentialGain: string;
  gainHypotheses: string[];
  validationStatus: FinalObjectiveValidationStatus;
  quickWin: string;
};

export type FinalObjectiveSet = {
  header: string;
  objectives: FinalObjective[];
  decisionsCapturedAt?: string;
};

export type DiagnosticSessionAggregate = {
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
};

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
  };
}

export function touchSession(
  session: DiagnosticSessionAggregate
): DiagnosticSessionAggregate {
  return {
    ...session,
    updatedAt: new Date().toISOString(),
  };
}

export function cloneRegistry(
  registry: SignalRegistry
): SignalRegistry {
  return deepClone(registry);
}

export function cloneWorkset(
  workset: IterationWorkset | null
): IterationWorkset | null {
  if (!workset) return null;
  return deepClone(workset);
}

export function answeredQuestionIds(
  workset: IterationWorkset | null
): Set<string> {
  if (!workset) return new Set<string>();
  return new Set(workset.answers.map((a) => a.questionId));
}

export function isWorksetFullyAnswered(
  workset: IterationWorkset | null
): boolean {
  if (!workset) return false;
  if (workset.questions.length === 0) return false;

  const answered = answeredQuestionIds(workset);
  return workset.questions.every((q) => answered.has(q.id));
}
