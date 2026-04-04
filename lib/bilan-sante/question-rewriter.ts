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

  return ` Vous avez déjà indiqué par exemple : "${shorten(fact, 110)}".`;
}

function wordCount(value: string): number {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean).length;
}

function countStructuredEt(value: string): number {
  return (normalizeText(value).match(/\set\s/gi) ?? []).length;
}

function hasAbstractOverload(value: string): boolean {
  const text = normalizeForMatch(value);
  const bannedPatterns = [
    "comment decrivez-vous",
    "comment décrivez-vous",
    "dans quelle mesure",
    "a quel moment precis",
    "à quel moment précis",
    "mecanisme actuel",
    "mécanisme actuel",
    "interactions concretes",
    "interactions concrètes",
    "effets en chaine",
    "effets en chaîne",
    "coherence globale",
    "cohérence globale",
    "articulation",
    "logique sous-jacente",
    "selon quel enchainement",
    "selon quel enchaînement",
    "avec quel effet visible",
    "repartons du bon angle",
  ];

  return bannedPatterns.some((pattern) => text.includes(normalizeForMatch(pattern)));
}

function hasMultipleControlAngles(value: string): boolean {
  const text = normalizeForMatch(value);

  let count = 0;
  if (/(qui arbitre|qui valide|qui decide|qui décide)/.test(text)) count += 1;
  if (/(sur quels criteres|sur quels critères|quel critere|quel critère)/.test(text)) count += 1;
  if (/(a quelle frequence|à quelle fréquence|rythme|cadence)/.test(text)) count += 1;
  if (/(formalise|formalisé|formalisee|formalisée|cas par cas)/.test(text)) count += 1;
  if (/(cause principale|cause racine|qu est-ce qui explique|qu'est-ce qui explique)/.test(text)) count += 1;
  if (/(risque concret|impact economique|impact économique)/.test(text)) count += 1;
  if (/(depend|dépend|personne cle|personne clé|relais)/.test(text)) count += 1;

  return count >= 2;
}

function isQuestionTooComplex(question: string): boolean {
  const text = normalizeText(question);
  if (!text) return true;
  if (wordCount(text) > 28) return true;
  if (countStructuredEt(text) > 1) return true;
  if (hasAbstractOverload(text)) return true;
  if (hasMultipleControlAngles(text)) return true;
  if ((text.match(/,/g) ?? []).length >= 3) return true;
  return false;
}

function buildShortQuestion(params: {
  theme: string;
  angle: EntryAngle | null | undefined;
  iteration: IterationNumber | null | undefined;
}): string {
  const { theme, angle, iteration } = params;

  switch (angle) {
    case "causality":
      return `Sur "${theme}", quelle est selon vous la cause principale de la difficulté ?`;

    case "arbitration":
      return iteration === 1
        ? `Sur "${theme}", qui décide concrètement aujourd'hui ?`
        : `Sur "${theme}", qui arbitre réellement ce point aujourd'hui ?`;

    case "economics":
      return `Sur "${theme}", quel impact économique concret voyez-vous aujourd'hui ?`;

    case "formalization":
      return `Sur "${theme}", est-ce formalisé ou géré au cas par cas ?`;

    case "dependency":
      return `Sur "${theme}", ce sujet dépend-il encore trop de quelques personnes ?`;

    case "mechanism":
    default:
      return iteration === 3
        ? `Sur "${theme}", quel est aujourd'hui le principal point faible ?`
        : `Sur "${theme}", comment cela fonctionne-t-il concrètement aujourd'hui ?`;
  }
}

function simplifyQuestion(params: {
  question: string;
  theme: string;
  angle: EntryAngle | null | undefined;
  iteration: IterationNumber | null | undefined;
  anchor?: string;
}): string {
  const { question, theme, angle, iteration, anchor = "" } = params;
  const text = normalizeText(question);

  if (!text) {
    return `${buildShortQuestion({ theme, angle, iteration })}${anchor}`;
  }

  const normalized = normalizeForMatch(text);

  if (
    normalized.includes("formal") ||
    normalized.includes("cadre") ||
    normalized.includes("rituel") ||
    normalized.includes("cas par cas")
  ) {
    return `Sur "${theme}", est-ce formalisé ou géré au cas par cas ?${anchor}`;
  }

  if (
    normalized.includes("arbitr") ||
    normalized.includes("valid") ||
    normalized.includes("decid") ||
    normalized.includes("décid")
  ) {
    return `Sur "${theme}", qui arbitre réellement ce point aujourd'hui ?${anchor}`;
  }

  if (
    normalized.includes("marge") ||
    normalized.includes("cash") ||
    normalized.includes("rentabil") ||
    normalized.includes("cout") ||
    normalized.includes("coût")
  ) {
    return `Sur "${theme}", quel impact économique concret voyez-vous aujourd'hui ?${anchor}`;
  }

  if (
    normalized.includes("depend") ||
    normalized.includes("dépend") ||
    normalized.includes("personne cle") ||
    normalized.includes("personne clé") ||
    normalized.includes("relais")
  ) {
    return `Sur "${theme}", ce sujet dépend-il encore trop de quelques personnes ?${anchor}`;
  }

  if (
    normalized.includes("cause") ||
    normalized.includes("explique") ||
    normalized.includes("produit la difficulte") ||
    normalized.includes("produit la difficulté")
  ) {
    return `Sur "${theme}", quelle est selon vous la cause principale de la difficulté ?${anchor}`;
  }

  if (
    iteration === 3 &&
    (normalized.includes("risque") ||
      normalized.includes("moins pilote") ||
      normalized.includes("moins piloté") ||
      normalized.includes("non suivi"))
  ) {
    return `Sur "${theme}", quel est aujourd'hui le principal point faible ?${anchor}`;
  }

  return `${buildShortQuestion({ theme, angle, iteration })}${anchor}`;
}

function cleanQuestionStyle(question: string): string {
  let out = normalizeText(question);

  out = out.replace(/^vous contestez le postulat initial\.?\s*/i, "");
  out = out.replace(/^reprenons donc\s*/i, "");
  out = out.replace(/^je reformule simplement\.?\s*/i, "");
  out = out.replace(/^restons sur\s*/i, "Sur ");
  out = out.replace(/\s+/g, " ").trim();

  if (!out.endsWith("?")) {
    out = `${out.replace(/[.]+$/, "")}?`;
  }

  return out;
}

function finalizeQuestion(params: {
  draft: string;
  theme: string;
  angle: EntryAngle | null | undefined;
  iteration: IterationNumber | null | undefined;
  anchor?: string;
}): string {
  const { draft, theme, angle, iteration, anchor = "" } = params;

  let question = cleanQuestionStyle(draft);

  if (isQuestionTooComplex(question)) {
    question = simplifyQuestion({
      question,
      theme,
      angle,
      iteration,
      anchor,
    });
  }

  question = cleanQuestionStyle(question);

  if (isQuestionTooComplex(question)) {
    question = cleanQuestionStyle(
      `${buildShortQuestion({ theme, angle, iteration })}${anchor}`
    );
  }

  return question;
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
      return `Sur "${theme}", quelle est selon vous la cause principale de la difficulté ?${anchor}`;

    case "arbitration":
      return iteration === 1
        ? `Sur "${theme}", qui décide concrètement aujourd'hui ?${anchor}`
        : `Sur "${theme}", qui arbitre réellement ce point aujourd'hui ?${anchor}`;

    case "economics":
      return `Sur "${theme}", quel impact économique concret voyez-vous aujourd'hui ?${anchor}`;

    case "formalization":
      return `Sur "${theme}", est-ce formalisé ou géré au cas par cas ?${anchor}`;

    case "dependency":
      return `Sur "${theme}", ce sujet dépend-il encore trop de quelques personnes ?${anchor}`;

    case "mechanism":
    default:
      return iteration === 3
        ? `Sur "${theme}", quel est aujourd'hui le principal point faible ?${anchor}`
        : `Sur "${theme}", comment cela fonctionne-t-il concrètement aujourd'hui ?${anchor}`;
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
    fallback = `Sur "${question.theme}", quel est aujourd'hui le problème concret observé ?${anchor}`;
  } else if (analysis.shouldPivotAngle && analysis.suggestedAngle) {
    fallback = buildAngleQuestion({
      theme: question.theme,
      angle: analysis.suggestedAngle,
      iteration,
      anchor,
    });
  } else if (analysis.intent === "challenge") {
    const fallbackAngle = analysis.suggestedAngle ?? currentAngle ?? "mechanism";
    fallback = buildAngleQuestion({
      theme: question.theme,
      angle: fallbackAngle,
      iteration,
      anchor,
    });
  } else if (analysis.intent === "noise") {
    if (coverage?.confirmedAngles.includes("mechanism")) {
      fallback = `Sur "${question.theme}", donnez-moi un exemple concret et récent.${anchor}`;
    } else {
      fallback = `Sur "${question.theme}", comment cela se passe-t-il concrètement aujourd'hui ?${anchor}`;
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
    return finalizeQuestion({
      draft: fallback,
      theme: question.theme,
      angle: analysis.suggestedAngle ?? currentAngle,
      iteration,
      anchor,
    });
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
    entryAngle:
      analysis.suggestedAngle ??
      currentAngle ??
      linkedSignal?.entryAngle ??
      "mechanism",
    trameEvidence:
      linkedSignal?.sourceExcerpt ?? linkedSignal?.constat ?? question.constat,
    extractedFacts,
    coveredAngles: coverage?.confirmedAngles ?? [],
    rejectedAngles: coverage?.rejectedAngles ?? [],
    isAbsence,
  });

  const draft = normalizeText(llmQuestion) || fallback;

  return finalizeQuestion({
    draft,
    theme: question.theme,
    angle:
      analysis.suggestedAngle ??
      currentAngle ??
      linkedSignal?.entryAngle ??
      "mechanism",
    iteration,
    anchor,
  });
}