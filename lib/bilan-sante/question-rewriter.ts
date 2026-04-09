import {
  buildRephrasedQuestionFromAnalysis,
  type AnswerAnalysis,
} from "@/lib/bilan-sante/answer-analyzer";
import type {
  DiagnosticSessionAggregate,
  DiagnosticSignal,
  EntryAngle,
  StructuredQuestion,
} from "@/lib/bilan-sante/session-model";
import {
  dimensionTitle,
  type DimensionId,
  type IterationNumber,
} from "@/lib/bilan-sante/protocol";
import { getThemeCoverage } from "@/lib/bilan-sante/coverage-tracker";
import { composeQuestionWithLlm } from "@/lib/bilan-sante/llm-diagnostic-writer";

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeForMatch(value: string | null | undefined): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function shorten(value: string | null | undefined, max = 160): string {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function sameTheme(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  return normalizeForMatch(left) === normalizeForMatch(right);
}

function uniqueStrings(values: Array<string | null | undefined>, max?: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = normalizeForMatch(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (max != null && out.length >= max) break;
  }

  return out;
}

function stripTheoreticalLeadIns(value: string): string {
  return normalizeText(value)
    .replace(/^dans un contexte ou\s+/i, "")
    .replace(/^dans un contexte où\s+/i, "")
    .replace(/^afin de\s+/i, "")
    .replace(/^en tenant compte de\s+/i, "")
    .replace(/^si l'on creuse\s+/i, "")
    .replace(/^si l’on creuse\s+/i, "");
}

function simplifyQuestionSurface(value: string, theme: string): string {
  let text = normalizeText(value);
  if (!text) return `Sur "${theme}", comment cela se passe-t-il concrètement aujourd’hui ?`;

  text = stripTheoreticalLeadIns(text);

  const lower = normalizeForMatch(text);

  if (
    lower.includes("dans un contexte ou") ||
    lower.includes("dans un contexte où") ||
    lower.includes("afin de") ||
    lower.includes("en tenant compte de")
  ) {
    return `Sur "${theme}", comment cela se passe-t-il concrètement aujourd’hui ?`;
  }

  if (text.length > 220) {
    const firstSentence = text.match(/^(.+?[?!.])(?:\s|$)/)?.[1];
    text = normalizeText(firstSentence ?? text);
  }

  if (text.length > 170) {
    return `Sur "${theme}", pouvez-vous me décrire concrètement ce qui se passe aujourd’hui ?`;
  }

  return text;
}

function allSignals(session: DiagnosticSessionAggregate): DiagnosticSignal[] {
  const registry = session.signalRegistry;
  if (!registry) return [];
  if ("all" in registry && Array.isArray(registry.all)) return registry.all;
  if ("allSignals" in registry && Array.isArray(registry.allSignals)) return registry.allSignals;
  return [
    ...registry.byDimension.d1,
    ...registry.byDimension.d2,
    ...registry.byDimension.d3,
    ...registry.byDimension.d4,
  ];
}

function findSignal(
  session: DiagnosticSessionAggregate,
  question: StructuredQuestion
): DiagnosticSignal | undefined {
  return allSignals(session).find((item) => item.id === question.signalId);
}

function latestFactAnchor(
  session: DiagnosticSessionAggregate,
  dimensionId: DimensionId | null | undefined,
  theme: string | null | undefined
): string {
  const normalizedTheme = normalizeText(theme);
  if (!normalizedTheme) return "";

  const latest = [...(session.analysisMemory ?? [])]
    .reverse()
    .find(
      (item) =>
        sameTheme(item.theme, normalizedTheme) &&
        (dimensionId == null || item.dimensionId === dimensionId) &&
        item.isUsableBusinessMatter &&
        (item.extractedFacts?.length ?? 0) > 0
    );

  const fact = latest?.extractedFacts?.[0];
  if (!fact) return "";

  return ` Vous avez déjà indiqué par exemple : "${shorten(fact)}".`;
}

function buildAngleQuestion(params: {
  theme: string;
  angle: EntryAngle;
  iteration: IterationNumber | null | undefined;
  anchor: string;
}): string {
  const { theme, angle, anchor } = params;

  switch (angle) {
    case "causality":
      return `Sur "${theme}", qu’est-ce qui explique surtout la situation actuelle ?${anchor}`;

    case "arbitration":
      return `Sur "${theme}", qui tranche réellement quand il faut décider ?${anchor}`;

    case "economics":
      return `Sur "${theme}", quel impact concret cela a-t-il aujourd’hui sur la marge, le coût ou le cash ?${anchor}`;

    case "formalization":
      return `Sur "${theme}", qu’est-ce qui n’est pas assez cadré aujourd’hui ?${anchor}`;

    case "dependency":
      return `Sur "${theme}", de qui ou de quoi dépendez-vous trop aujourd’hui ?${anchor}`;

    case "mechanism":
    default:
      return `Sur "${theme}", comment cela se passe-t-il concrètement aujourd’hui ?${anchor}`;
  }
}

export async function rewriteQuestionFromAnalysis(params: {
  session: DiagnosticSessionAggregate;
  question: StructuredQuestion;
  rawMessage: string;
  analysis: AnswerAnalysis;
  dimensionId: DimensionId | null | undefined;
  iteration: IterationNumber | null | undefined;
  currentAngle: EntryAngle | null;
}): Promise<string> {
  const {
    session,
    question,
    analysis,
    dimensionId,
    iteration,
    currentAngle,
  } = params;

  const anchor = latestFactAnchor(session, dimensionId, question.theme);
  const coverage =
    dimensionId != null
      ? getThemeCoverage(session, dimensionId, question.theme)
      : null;
  const linkedSignal = findSignal(session, question);

  let fallback = question.questionOuverte;

  if (analysis.intent === "clarification_request") {
    fallback = `Je reformule simplement. Sur "${question.theme}", qu’est-ce qui se passe concrètement aujourd’hui ?${anchor}`;
  } else if (analysis.shouldPivotAngle && analysis.suggestedAngle) {
    fallback = buildAngleQuestion({
      theme: question.theme,
      angle: analysis.suggestedAngle,
      iteration,
      anchor,
    });
  } else if (analysis.intent === "challenge") {
    const fallbackAngle = analysis.suggestedAngle ?? currentAngle ?? "mechanism";
    fallback = `Reprenons "${question.theme}" sans présupposé. ${buildAngleQuestion({
      theme: question.theme,
      angle: fallbackAngle,
      iteration,
      anchor: "",
    })}${anchor}`;
  } else if (analysis.intent === "noise") {
    if (coverage?.confirmedAngles.includes("mechanism")) {
      fallback = `Restons sur "${question.theme}". Pouvez-vous me donner un exemple concret et récent ?${anchor}`;
    } else {
      fallback = `Restons sur "${question.theme}". Comment cela se passe-t-il concrètement aujourd’hui ?${anchor}`;
    }
  } else {
    const rewritten = buildRephrasedQuestionFromAnalysis({
      analysis,
      currentQuestion: {
        theme: question.theme,
        constat: question.constat,
        questionOuverte: question.questionOuverte,
        entryAngle: analysis.suggestedAngle ?? currentAngle,
      },
    });

    fallback = normalizeText(rewritten) || question.questionOuverte;
  }

  if (dimensionId == null || iteration == null) {
    return simplifyQuestionSurface(fallback, question.theme);
  }

  const normalizedConstat = normalizeForMatch(question.constat);
  const isAbsence =
    normalizedConstat.includes("no_evidence") ||
    normalizedConstat.includes("no evidence") ||
    normalizedConstat.includes("insuffisamment etaye") ||
    normalizedConstat.includes("insuffisamment étaye") ||
    normalizedConstat.includes("non documente") ||
    normalizedConstat.includes("non documenté");

  const extractedFacts = uniqueStrings(
    [
      ...(session.analysisMemory ?? [])
        .filter(
          (item) =>
            sameTheme(item.theme, question.theme) &&
            item.isUsableBusinessMatter
        )
        .flatMap((item) => item.extractedFacts ?? []),
      analysis.summary,
    ],
    4
  );

  const llmQuestion = await composeQuestionWithLlm({
    dimensionId,
    dimensionTitle: dimensionTitle(dimensionId),
    iteration,
    theme: question.theme,
    constat: question.constat,
    managerialRisk: question.risqueManagerial,
    entryAngle: analysis.suggestedAngle ?? currentAngle ?? linkedSignal?.entryAngle ?? "mechanism",
    trameEvidence: linkedSignal?.sourceExcerpt ?? linkedSignal?.constat ?? question.constat,
    extractedFacts,
    coveredAngles: coverage?.confirmedAngles ?? [],
    rejectedAngles: coverage?.rejectedAngles ?? [],
    isAbsence,
  });

  return simplifyQuestionSurface(normalizeText(llmQuestion) || fallback, question.theme);
}