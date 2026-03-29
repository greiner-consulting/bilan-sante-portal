import type {
  DiagnosticSessionAggregate,
  EntryAngle,
  StructuredQuestion,
  ThemeCoverageMark,
  ThemeCoverageRecord,
} from "@/lib/bilan-sante/session-model";
import type { DimensionId, IterationNumber } from "@/lib/bilan-sante/protocol";

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: string | null | undefined): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function uniqueAngles(values: EntryAngle[]): EntryAngle[] {
  return [...new Set(values)];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function coverageId(dimensionId: DimensionId, theme: string): string {
  return `cov-d${dimensionId}-${normalizeForMatch(theme).replace(/[^a-z0-9]+/g, "-")}`;
}

function emptyCoverageRecord(
  dimensionId: DimensionId,
  theme: string
): ThemeCoverageRecord {
  return {
    id: coverageId(dimensionId, theme),
    dimensionId,
    theme: normalizeText(theme),
    askedAngles: [],
    confirmedAngles: [],
    rejectedAngles: [],
    askedQuestionIds: [],
    confirmedQuestionIds: [],
    lastQuestionId: null,
    lastQuestionText: null,
    lastIteration: null,
    factDensity: 0,
    closureStatus: "open",
    angleHistory: [],
    notes: [],
    updatedAt: new Date().toISOString(),
  };
}

function sameHistoryMark(
  left: ThemeCoverageMark,
  right: ThemeCoverageMark
): boolean {
  return (
    left.angle === right.angle &&
    left.iteration === right.iteration &&
    left.questionId === right.questionId &&
    left.status === right.status
  );
}

function upsertCoverage(
  session: DiagnosticSessionAggregate,
  nextRecord: ThemeCoverageRecord
): DiagnosticSessionAggregate {
  const current = session.themeCoverage ?? [];
  const filtered = current.filter(
    (item) =>
      !(
        item.dimensionId === nextRecord.dimensionId &&
        normalizeForMatch(item.theme) === normalizeForMatch(nextRecord.theme)
      )
  );

  return {
    ...session,
    themeCoverage: [...filtered, nextRecord].sort((a, b) => {
      if (a.dimensionId !== b.dimensionId) return a.dimensionId - b.dimensionId;
      return normalizeText(a.theme).localeCompare(normalizeText(b.theme), "fr");
    }),
  };
}

export function getThemeCoverage(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  theme: string
): ThemeCoverageRecord | null {
  const normalizedTheme = normalizeForMatch(theme);

  const found = (session.themeCoverage ?? []).find(
    (item) =>
      item.dimensionId === dimensionId &&
      normalizeForMatch(item.theme) === normalizedTheme
  );

  return found ?? null;
}

export function listThemeCoverage(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId
): ThemeCoverageRecord[] {
  return (session.themeCoverage ?? []).filter(
    (item) => item.dimensionId === dimensionId
  );
}

export function wasAngleMarkedInPriorIterations(params: {
  session: DiagnosticSessionAggregate;
  dimensionId: DimensionId;
  theme: string;
  angle: EntryAngle;
  currentIteration: IterationNumber;
  statuses?: Array<"asked" | "confirmed" | "rejected">;
}): boolean {
  const coverage = getThemeCoverage(params.session, params.dimensionId, params.theme);
  if (!coverage) return false;

  const statuses = params.statuses ?? ["asked", "confirmed"];

  return coverage.angleHistory.some(
    (item) =>
      item.angle === params.angle &&
      item.iteration != null &&
      item.iteration < params.currentIteration &&
      statuses.includes(item.status)
  );
}

export function registerWorksetQuestions(
  session: DiagnosticSessionAggregate
): DiagnosticSessionAggregate {
  const workset = session.currentWorkset;
  if (!workset) return session;

  let nextSession = session;

  for (const question of workset.questions) {
    nextSession = registerQuestionAsked({
      session: nextSession,
      question,
      dimensionId: workset.dimensionId,
      iteration: workset.iteration,
    });
  }

  return nextSession;
}

export function registerQuestionAsked(params: {
  session: DiagnosticSessionAggregate;
  question: StructuredQuestion;
  dimensionId: DimensionId;
  iteration: IterationNumber;
  angle?: EntryAngle | null;
  note?: string;
}): DiagnosticSessionAggregate {
  const angle = params.angle ?? null;
  const existing =
    getThemeCoverage(params.session, params.dimensionId, params.question.theme) ??
    emptyCoverageRecord(params.dimensionId, params.question.theme);

  const nextHistory = [...existing.angleHistory];
  if (angle) {
    const candidate: ThemeCoverageMark = {
      angle,
      iteration: params.iteration,
      questionId: params.question.id,
      status: "asked",
    };

    if (!nextHistory.some((item) => sameHistoryMark(item, candidate))) {
      nextHistory.push(candidate);
    }
  }

  const nextRecord: ThemeCoverageRecord = {
    ...existing,
    askedAngles: angle
      ? uniqueAngles([...existing.askedAngles, angle])
      : existing.askedAngles,
    askedQuestionIds: uniqueStrings([...existing.askedQuestionIds, params.question.id]),
    lastQuestionId: params.question.id,
    lastQuestionText: params.question.questionOuverte,
    lastIteration: params.iteration,
    angleHistory: nextHistory,
    notes: params.note
      ? uniqueStrings([...existing.notes, params.note])
      : existing.notes,
    updatedAt: new Date().toISOString(),
  };

  return upsertCoverage(params.session, nextRecord);
}

export function registerAnswerInsight(params: {
  session: DiagnosticSessionAggregate;
  dimensionId: DimensionId;
  iteration: IterationNumber;
  question: StructuredQuestion;
  askedAngle: EntryAngle | null;
  confirmedAngle?: EntryAngle | null;
  rejectedAngle?: EntryAngle | null;
  extractedFacts?: string[];
  note?: string;
}): DiagnosticSessionAggregate {
  const existing =
    getThemeCoverage(params.session, params.dimensionId, params.question.theme) ??
    emptyCoverageRecord(params.dimensionId, params.question.theme);

  const nextHistory = [...existing.angleHistory];

  if (params.confirmedAngle) {
    const candidate: ThemeCoverageMark = {
      angle: params.confirmedAngle,
      iteration: params.iteration,
      questionId: params.question.id,
      status: "confirmed",
    };
    if (!nextHistory.some((item) => sameHistoryMark(item, candidate))) {
      nextHistory.push(candidate);
    }
  }

  if (params.rejectedAngle) {
    const candidate: ThemeCoverageMark = {
      angle: params.rejectedAngle,
      iteration: params.iteration,
      questionId: params.question.id,
      status: "rejected",
    };
    if (!nextHistory.some((item) => sameHistoryMark(item, candidate))) {
      nextHistory.push(candidate);
    }
  }

  const factDelta = Math.max(0, (params.extractedFacts ?? []).filter(Boolean).length);
  const confirmedAngles = params.confirmedAngle
    ? uniqueAngles([...existing.confirmedAngles, params.confirmedAngle])
    : existing.confirmedAngles;

  const closureStatus =
    confirmedAngles.length >= 2 || existing.factDensity + factDelta >= 3
      ? "saturated"
      : existing.closureStatus;

  const nextRecord: ThemeCoverageRecord = {
    ...existing,
    confirmedAngles,
    rejectedAngles: params.rejectedAngle
      ? uniqueAngles([...existing.rejectedAngles, params.rejectedAngle])
      : existing.rejectedAngles,
    confirmedQuestionIds: params.confirmedAngle
      ? uniqueStrings([...existing.confirmedQuestionIds, params.question.id])
      : existing.confirmedQuestionIds,
    factDensity: existing.factDensity + factDelta,
    lastQuestionId: params.question.id,
    lastQuestionText: params.question.questionOuverte,
    lastIteration: params.iteration,
    closureStatus,
    angleHistory: nextHistory,
    notes: uniqueStrings([
      ...existing.notes,
      params.note ?? "",
      ...(params.extractedFacts ?? []).slice(0, 2),
    ]),
    updatedAt: new Date().toISOString(),
  };

  return upsertCoverage(params.session, nextRecord);
}

export function closeCoverageForIteration(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  iteration: IterationNumber
): DiagnosticSessionAggregate {
  const items = listThemeCoverage(session, dimensionId).map((item) => {
    if (item.lastIteration !== iteration) return item;

    return {
      ...item,
      closureStatus:
        item.confirmedAngles.length > 0 || item.factDensity > 0 ? "closed" : item.closureStatus,
      updatedAt: new Date().toISOString(),
    };
  });

  return {
    ...session,
    themeCoverage: [
      ...(session.themeCoverage ?? []).filter((item) => item.dimensionId !== dimensionId),
      ...items,
    ].sort((a, b) => {
      if (a.dimensionId !== b.dimensionId) return a.dimensionId - b.dimensionId;
      return normalizeText(a.theme).localeCompare(normalizeText(b.theme), "fr");
    }),
  };
}

export function coveredAnglesForDimension(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId,
  iteration?: IterationNumber | null
): EntryAngle[] {
  const items = listThemeCoverage(session, dimensionId);

  const angleValues = items.flatMap((item) =>
    item.angleHistory
      .filter((mark) => (iteration == null ? true : mark.iteration === iteration))
      .filter((mark) => mark.status === "asked" || mark.status === "confirmed")
      .map((mark) => mark.angle)
  );

  return uniqueAngles(angleValues);
}
