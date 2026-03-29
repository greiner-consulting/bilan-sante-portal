import type {
  DiagnosticSessionAggregate,
  EntryAngle,
  IterationWorkset,
  StructuredQuestion,
} from "@/lib/bilan-sante/session-model";
import type { DimensionId, IterationNumber } from "@/lib/bilan-sante/protocol";
import {
  coveredAnglesForDimension,
  getThemeCoverage,
  wasAngleMarkedInPriorIterations,
} from "@/lib/bilan-sante/coverage-tracker";

export type IterationClosureDecision = {
  shouldAskValidation: boolean;
  qualityStop: boolean;
  remainingLowValue: boolean;
  uncoveredMandatoryAngles: EntryAngle[];
  highValueRemainderQuestionIds: string[];
  reasonCodes: string[];
  notes: string[];
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

export function mandatoryAnglesForIteration(
  iteration: IterationNumber
): EntryAngle[] {
  switch (iteration) {
    case 1:
      return ["mechanism", "formalization"];
    case 2:
      return ["causality", "arbitration"];
    case 3:
      return ["formalization", "dependency"];
    default:
      return [];
  }
}

function isWeakTailQuestion(question: StructuredQuestion): boolean {
  const constat = normalizeForMatch(question.constat);
  const questionText = normalizeForMatch(question.questionOuverte);
  const theme = normalizeForMatch(question.theme);

  return (
    constat.includes("no_evidence") ||
    constat.includes("no evidence") ||
    constat.includes("insuffisamment etaye") ||
    constat.includes("insuffisamment étayé") ||
    constat.includes("non documente") ||
    constat.includes("non documenté") ||
    questionText.includes("comment ce sujet est il reellement traite") ||
    questionText.includes("comment ce sujet est-il reellement traite") ||
    questionText.includes("comment ce sujet est-il réellement traité") ||
    theme.includes("recrutement et integration") ||
    theme.includes("recrutement et intégration")
  );
}

function findSignalAngle(
  session: DiagnosticSessionAggregate,
  question: StructuredQuestion
): EntryAngle | null {
  const registry = session.signalRegistry;
  if (!registry) return null;

  const signal = (registry.allSignals ?? []).find((item) => item.id === question.signalId);
  return signal?.entryAngle ?? null;
}

function residualValueScore(params: {
  session: DiagnosticSessionAggregate;
  workset: IterationWorkset;
  question: StructuredQuestion;
}): number {
  const { session, workset, question } = params;
  const angle = findSignalAngle(session, question);
  const coverage = getThemeCoverage(session, workset.dimensionId, question.theme);

  let score = 50;

  if (isWeakTailQuestion(question)) score -= 35;
  if (!angle) score -= 10;

  if (angle && coverage) {
    if (coverage.confirmedAngles.includes(angle)) score -= 40;
    if (coverage.askedAngles.includes(angle)) score -= 18;
    if (coverage.factDensity >= 2) score -= 12;
    if (coverage.closureStatus === "saturated") score -= 15;
  }

  if (
    angle &&
    wasAngleMarkedInPriorIterations({
      session,
      dimensionId: workset.dimensionId,
      theme: question.theme,
      angle,
      currentIteration: workset.iteration,
      statuses: ["asked", "confirmed"],
    })
  ) {
    score -= workset.iteration === 3 ? 30 : 18;
  }

  const mandatoryAngles = mandatoryAnglesForIteration(workset.iteration);
  if (angle && mandatoryAngles.includes(angle)) {
    const covered = coveredAnglesForDimension(
      session,
      workset.dimensionId,
      workset.iteration
    );
    if (!covered.includes(angle)) {
      score += 18;
    }
  }

  return score;
}

export function trimLowValueTail(params: {
  session: DiagnosticSessionAggregate;
  dimensionId: DimensionId;
  iteration: IterationNumber;
  questions: StructuredQuestion[];
  minimumRequiredCount: number;
}): StructuredQuestion[] {
  const workset: IterationWorkset = {
    dimensionId: params.dimensionId,
    iteration: params.iteration,
    header: "",
    questions: params.questions,
    answers: [],
    closurePrompt: "",
    targetQuestionCount: params.questions.length,
    minimumRequiredCount: params.minimumRequiredCount,
  };

  const trimmed = [...params.questions];

  while (trimmed.length > params.minimumRequiredCount) {
    const tail = trimmed[trimmed.length - 1];
    if (!tail) break;

    const score = residualValueScore({
      session: params.session,
      workset: { ...workset, questions: trimmed },
      question: tail,
    });

    if (score >= 20) break;
    trimmed.pop();
  }

  return trimmed;
}

export function decideIterationClosure(
  session: DiagnosticSessionAggregate
): IterationClosureDecision {
  const workset = session.currentWorkset;
  if (!workset) {
    return {
      shouldAskValidation: false,
      qualityStop: false,
      remainingLowValue: false,
      uncoveredMandatoryAngles: [],
      highValueRemainderQuestionIds: [],
      reasonCodes: ["no_workset"],
      notes: ["Aucun workset actif."],
    };
  }

  const answeredIds = new Set(workset.answers.map((item) => item.questionId));
  const answeredCount = workset.answers.length;
  const remainingQuestions = workset.questions.filter(
    (question) => !answeredIds.has(question.id)
  );

  if (answeredCount < workset.minimumRequiredCount) {
    return {
      shouldAskValidation: false,
      qualityStop: false,
      remainingLowValue: false,
      uncoveredMandatoryAngles: [],
      highValueRemainderQuestionIds: remainingQuestions.map((item) => item.id),
      reasonCodes: ["minimum_not_reached"],
      notes: ["Le plancher qualitatif de l’itération n’est pas encore atteint."],
    };
  }

  if (remainingQuestions.length === 0) {
    return {
      shouldAskValidation: true,
      qualityStop: false,
      remainingLowValue: false,
      uncoveredMandatoryAngles: [],
      highValueRemainderQuestionIds: [],
      reasonCodes: ["workset_exhausted"],
      notes: ["Toutes les questions du workset ont reçu une réponse."],
    };
  }

  const coveredAngles = coveredAnglesForDimension(
    session,
    workset.dimensionId,
    workset.iteration
  );

  const uncoveredMandatoryAngles = mandatoryAnglesForIteration(workset.iteration).filter(
    (angle) => !coveredAngles.includes(angle)
  );

  if (uncoveredMandatoryAngles.length > 0) {
    return {
      shouldAskValidation: false,
      qualityStop: false,
      remainingLowValue: false,
      uncoveredMandatoryAngles,
      highValueRemainderQuestionIds: remainingQuestions.map((item) => item.id),
      reasonCodes: ["mandatory_angles_missing"],
      notes: [
        `Des angles structurants restent à couvrir : ${uncoveredMandatoryAngles.join(", ")}.`,
      ],
    };
  }

  const scoredRemainder = remainingQuestions.map((question) => ({
    question,
    score: residualValueScore({ session, workset, question }),
  }));

  const highValueRemainderQuestionIds = scoredRemainder
    .filter((item) => item.score >= 20)
    .map((item) => item.question.id);

  const remainingLowValue =
    highValueRemainderQuestionIds.length === 0 ||
    scoredRemainder.every((item) => item.score < 20);

  if (remainingLowValue) {
    return {
      shouldAskValidation: true,
      qualityStop: true,
      remainingLowValue: true,
      uncoveredMandatoryAngles: [],
      highValueRemainderQuestionIds: [],
      reasonCodes: ["quality_stop", "residual_low_value"],
      notes: [
        "Les questions restantes sont jugées faibles, redondantes ou insuffisamment contributives.",
      ],
    };
  }

  return {
    shouldAskValidation: false,
    qualityStop: false,
    remainingLowValue: false,
    uncoveredMandatoryAngles: [],
    highValueRemainderQuestionIds,
    reasonCodes: ["continue_iteration"],
    notes: ["Des questions restantes gardent un intérêt informationnel suffisant."],
  };
}
