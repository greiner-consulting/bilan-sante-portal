import type {
  DiagnosticSignal,
  DiagnosticSessionState,
  DimensionId,
  IterationNumber,
  QuestionIntent,
  StructuredQuestion,
} from "@/lib/bilan-sante/session-model";
import { getDimensionDefinition } from "@/lib/bilan-sante/protocol";

export type AnswerAnalysisIntent =
  | "clarification_request"
  | "challenge"
  | "noise"
  | "partial_answer"
  | "usable_answer";

export interface AnswerAnalysis {
  intent: AnswerAnalysisIntent;
  summary?: string;
  shouldPivotIntent?: boolean;
  suggestedIntent?: QuestionIntent | null;
  extractedFacts?: string[];
}

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

function wordCount(value: string): number {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean).length;
}

function countStructuredEt(value: string): number {
  return (normalizeText(value).match(/\set\s/gi) ?? []).length;
}

function isQuestionTooComplex(question: string): boolean {
  const text = normalizeText(question);
  if (!text) return true;
  if (wordCount(text) > 28) return true;
  if (countStructuredEt(text) > 1) return true;
  if ((text.match(/,/g) ?? []).length >= 3) return true;
  return false;
}

function latestFactAnchor(
  session: DiagnosticSessionState,
  question: StructuredQuestion
): string {
  const signalIds = new Set(question.supportSignalIds ?? []);

  const facts = session.signals
    .filter((signal) => signalIds.has(signal.id))
    .map((signal) => signal.factAtomic)
    .filter(Boolean);

  const firstFact = facts[0];
  if (!firstFact) return "";

  return ` Vous avez déjà indiqué par exemple : "${shorten(firstFact, 110)}".`;
}

function findLinkedSignals(
  session: DiagnosticSessionState,
  question: StructuredQuestion
): DiagnosticSignal[] {
  const signalIds = new Set(question.supportSignalIds ?? []);
  return session.signals.filter((signal) => signalIds.has(signal.id));
}

function buildShortQuestion(params: {
  objectLabel: string;
  intent: QuestionIntent;
  iteration: IterationNumber | null | undefined;
}): string {
  const { objectLabel, intent, iteration } = params;

  switch (intent) {
    case "open_core":
      return `Sur ${objectLabel}, comment cela se passe-t-il concrètement aujourd'hui ?`;

    case "clarify_mechanism":
      return `Sur ${objectLabel}, par quel mécanisme la situation se produit-elle réellement ?`;

    case "identify_threshold":
      return `Sur ${objectLabel}, à partir de quel seuil ou de quelle situation cela se tend-il réellement ?`;

    case "test_formalization":
      return `Sur ${objectLabel}, qu'est-ce qui est formalisé et qu'est-ce qui repose encore surtout sur les usages ?`;

    case "identify_dependency":
      return `Sur ${objectLabel}, de qui ou de quoi dépend-on le plus pour que cela tienne ?`;

    case "test_anticipation":
      return `Sur ${objectLabel}, comment ce point est-il anticipé en amont lorsqu'il commence à dériver ?`;

    case "confirm_strength":
      return `Sur ${objectLabel}, qu'est-ce qui fonctionne bien de manière réellement fiable ?`;

    case "validate_priority":
      return iteration === 3
        ? `Sur ${objectLabel}, quel est aujourd'hui le principal point à sécuriser en priorité ?`
        : `Sur ${objectLabel}, quel est aujourd'hui le point prioritaire à traiter ?`;

    default:
      return `Pouvez-vous préciser concrètement ce point : ${objectLabel} ?`;
  }
}

function simplifyQuestion(params: {
  question: string;
  objectLabel: string;
  intent: QuestionIntent;
  iteration: IterationNumber | null | undefined;
  anchor?: string;
}): string {
  const { question, objectLabel, intent, iteration, anchor = "" } = params;
  const text = normalizeForMatch(question);

  if (
    text.includes("formal") ||
    text.includes("cadre") ||
    text.includes("rituel") ||
    text.includes("cas par cas")
  ) {
    return `Sur ${objectLabel}, qu'est-ce qui est formalisé et qu'est-ce qui repose encore surtout sur les usages ?${anchor}`;
  }

  if (
    text.includes("depend") ||
    text.includes("dépend") ||
    text.includes("personne cle") ||
    text.includes("personne clé") ||
    text.includes("relais")
  ) {
    return `Sur ${objectLabel}, de qui ou de quoi dépend-on le plus pour que cela tienne ?${anchor}`;
  }

  if (
    text.includes("seuil") ||
    text.includes("a partir de quand") ||
    text.includes("à partir de quand") ||
    text.includes("bascule")
  ) {
    return `Sur ${objectLabel}, à partir de quel seuil ou de quelle situation cela se tend-il réellement ?${anchor}`;
  }

  if (
    text.includes("anticip") ||
    text.includes("amont") ||
    text.includes("avant que")
  ) {
    return `Sur ${objectLabel}, comment ce point est-il anticipé en amont lorsqu'il commence à dériver ?${anchor}`;
  }

  return `${buildShortQuestion({ objectLabel, intent, iteration })}${anchor}`;
}

function cleanQuestionStyle(question: string): string {
  let out = normalizeText(question);

  out = out.replace(/^je reformule simplement\.?\s*/i, "");
  out = out.replace(/^reprenons\s*/i, "");
  out = out.replace(/^restons sur\s*/i, "Sur ");
  out = out.replace(/\s+/g, " ").trim();

  if (!out.endsWith("?")) {
    out = `${out.replace(/[.]+$/, "")}?`;
  }

  return out;
}

function finalizeQuestion(params: {
  draft: string;
  objectLabel: string;
  intent: QuestionIntent;
  iteration: IterationNumber | null | undefined;
  anchor?: string;
}): string {
  const { draft, objectLabel, intent, iteration, anchor = "" } = params;

  let question = cleanQuestionStyle(draft);

  if (isQuestionTooComplex(question)) {
    question = simplifyQuestion({
      question,
      objectLabel,
      intent,
      iteration,
      anchor,
    });
  }

  question = cleanQuestionStyle(question);

  if (isQuestionTooComplex(question)) {
    question = cleanQuestionStyle(
      `${buildShortQuestion({ objectLabel, intent, iteration })}${anchor}`
    );
  }

  return question;
}

function chooseIntent(params: {
  question: StructuredQuestion;
  analysis: AnswerAnalysis;
}): QuestionIntent {
  if (params.analysis.shouldPivotIntent && params.analysis.suggestedIntent) {
    return params.analysis.suggestedIntent;
  }

  if (params.analysis.intent === "clarification_request") {
    return "open_core";
  }

  if (params.analysis.intent === "challenge") {
    return params.analysis.suggestedIntent ?? "clarify_mechanism";
  }

  if (params.analysis.intent === "noise") {
    return "open_core";
  }

  return params.question.questionIntent;
}

function buildFallbackQuestion(params: {
  session: DiagnosticSessionState;
  question: StructuredQuestion;
  analysis: AnswerAnalysis;
  dimensionId: DimensionId | null | undefined;
  iteration: IterationNumber | null | undefined;
}): string {
  const { session, question, analysis, iteration } = params;
  const objectLabel = question.objectLabel;
  const nextIntent = chooseIntent({ question, analysis });
  const anchor = latestFactAnchor(session, question);

  if (analysis.intent === "clarification_request") {
    return `Sur ${objectLabel}, quel est aujourd'hui le problème concret observé ?${anchor}`;
  }

  if (analysis.intent === "noise") {
    return `Sur ${objectLabel}, donnez-moi un exemple concret et récent.${anchor}`;
  }

  if (analysis.intent === "challenge") {
    return `${buildShortQuestion({
      objectLabel,
      intent: nextIntent,
      iteration,
    })}${anchor}`;
  }

  const extractedFacts = uniqueStrings(
    [...(analysis.extractedFacts ?? []), analysis.summary],
    3
  );

  if (extractedFacts.length > 0) {
    return `Sur ${objectLabel}, en repartant de "${shorten(
      extractedFacts[0],
      90
    )}", pouvez-vous préciser concrètement ce point ?${anchor}`;
  }

  return `${buildShortQuestion({
    objectLabel,
    intent: nextIntent,
    iteration,
  })}${anchor}`;
}

export async function rewriteQuestionFromAnalysis(params: {
  session: DiagnosticSessionState;
  question: StructuredQuestion;
  rawMessage: string;
  analysis: AnswerAnalysis;
  dimensionId: DimensionId | null | undefined;
  iteration: IterationNumber | null | undefined;
}): Promise<string> {
  const { session, question, analysis, dimensionId, iteration } = params;

  const dimensionLabel =
    dimensionId != null ? getDimensionDefinition(dimensionId).label : "";

  const linkedSignals = findLinkedSignals(session, question);
  const linkedFacts = uniqueStrings(
    [
      ...linkedSignals.map((signal) => signal.factAtomic),
      ...(analysis.extractedFacts ?? []),
      analysis.summary,
    ],
    4
  );

  let draft = buildFallbackQuestion({
    session,
    question,
    analysis,
    dimensionId,
    iteration,
  });

  if (
    analysis.intent === "usable_answer" &&
    linkedFacts.length > 0
  ) {
    draft = `Sur ${question.objectLabel}, à partir de ce que vous venez de préciser${
      dimensionLabel ? ` pour la dimension ${dimensionLabel}` : ""
    }, quel est maintenant le point le plus important à comprendre concrètement ?`;
  }

  return finalizeQuestion({
    draft,
    objectLabel: question.objectLabel,
    intent: chooseIntent({ question, analysis }),
    iteration,
    anchor: latestFactAnchor(session, question),
  });
}