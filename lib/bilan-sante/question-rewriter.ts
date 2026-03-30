import {
  buildRephrasedQuestionFromAnalysis,
  type AnswerAnalysis,
} from "@/lib/bilan-sante/answer-analyzer";
import type {
  DiagnosticSessionAggregate,
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
  const { theme, angle, iteration, anchor } = params;

  switch (angle) {
    case "causality":
      if (iteration === 1) {
        return `Restons sur "${theme}", mais repartons du bon angle : qu’est-ce qui produit réellement la difficulté aujourd’hui, et qu’est-ce qui l’explique dans le fonctionnement concret ?${anchor}`;
      }
      return `Sur "${theme}", si vous remontez à la cause racine, est-ce surtout un sujet de compétences, d’expérience, de décisions prises ou d’organisation mal posée ?${anchor}`;

    case "arbitration":
      return `Sur "${theme}", qui arbitre réellement, qui valide, où la décision se bloque-t-elle, et en quoi cette chaîne d’arbitrage entretient-elle la situation actuelle ?${anchor}`;

    case "economics":
      return `Sur "${theme}", quel est l’impact économique réellement subi aujourd’hui : marge, coût réel, cash, rentabilité ou sélectivité d’affaires ? Et comment cet impact se matérialise-t-il ?${anchor}`;

    case "formalization":
      return `Sur "${theme}", qu’est-ce qui relève surtout d’un manque de cadre, de rôles clairs, de méthode, de rituel ou de pilotage formalisé ?${anchor}`;

    case "dependency":
      return `Sur "${theme}", où se situe la dépendance la plus pénalisante aujourd’hui : une personne clé, un validateur, une ressource rare, un passage obligé ou une zone sans relais ?${anchor}`;

    case "mechanism":
    default:
      return `Sur "${theme}", comment le problème se produit-il concrètement dans le fonctionnement réel : à quel moment, avec quels acteurs, selon quel enchaînement, et avec quel effet visible ?${anchor}`;
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

  let fallback = question.questionOuverte;

  if (analysis.intent === "clarification_request") {
    fallback = `Je reformule simplement. Sur "${question.theme}", quel est aujourd’hui le problème concret observé, qui est impliqué, et comment ce sujet est-il réellement piloté ?${anchor}`;
  } else if (analysis.shouldPivotAngle && analysis.suggestedAngle) {
    fallback = buildAngleQuestion({
      theme: question.theme,
      angle: analysis.suggestedAngle,
      iteration,
      anchor,
    });
  } else if (analysis.intent === "challenge") {
    const fallbackAngle = analysis.suggestedAngle ?? currentAngle ?? "mechanism";
    fallback = `Vous contestez le postulat initial. Reprenons donc "${question.theme}" sans présupposé : ${buildAngleQuestion({
      theme: question.theme,
      angle: fallbackAngle,
      iteration,
      anchor: "",
    })}${anchor}`;
  } else if (analysis.intent === "noise") {
    if (coverage?.confirmedAngles.includes("mechanism")) {
      fallback = `Restons sur "${question.theme}". Donnez-moi un exemple précis, récent et observable qui montre où le sujet se dérègle réellement aujourd’hui.${anchor}`;
    } else {
      fallback = `Restons sur "${question.theme}". Décrivez-moi un cas concret, récent, vécu, qui montre comment le sujet fonctionne réellement aujourd’hui.${anchor}`;
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
    return fallback;
  }

  const normalizedConstat = normalizeForMatch(question.constat);
  const isAbsence =
    normalizedConstat.includes("no_evidence") ||
    normalizedConstat.includes("no evidence") ||
    normalizedConstat.includes("insuffisamment etaye") ||
    normalizedConstat.includes("insuffisamment étaye") ||
    normalizedConstat.includes("non documente") ||
    normalizedConstat.includes("non documente");

  const extractedFacts = (session.analysisMemory ?? [])
    .filter(
      (item) => sameTheme(item.theme, question.theme) && item.isUsableBusinessMatter
    )
    .flatMap((item) => item.extractedFacts ?? [])
    .slice(-3);

  const llmQuestion = await composeQuestionWithLlm({
    dimensionId,
    dimensionTitle: dimensionTitle(dimensionId),
    iteration,
    theme: question.theme,
    constat: question.constat,
    managerialRisk: question.risqueManagerial,
    entryAngle: analysis.suggestedAngle ?? currentAngle ?? "mechanism",
    trameEvidence: question.constat,
    extractedFacts,
    coveredAngles: coverage?.confirmedAngles ?? [],
    rejectedAngles: coverage?.rejectedAngles ?? [],
    isAbsence,
  });

  return normalizeText(llmQuestion) || fallback;
}