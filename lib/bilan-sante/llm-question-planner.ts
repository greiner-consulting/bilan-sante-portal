// lib/bilan-sante/llm-question-planner.ts

import type { QuestionIntent } from "@/lib/bilan-sante/session-model";

export type QuestionRewriteInput = {
  theme: string;
  intent: QuestionIntent;
  rawQuestion: string;
  maxWords?: number;
};

function countWords(text: string): number {
  return String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function compact(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function removeTrailingLists(text: string): string {
  return text.replace(/\s*:\s*[^?]+\?$/, "?");
}

function removeWideAlternatives(text: string): string {
  return text.replace(/\s+ou\s+[^?]+\?$/, " ?");
}

function simplifyByIntent(
  intent: QuestionIntent,
  theme: string
): string {
  switch (intent) {
    case "describe_mechanism":
      return `Aujourd’hui, sur "${theme}", comment cela se passe concrètement ?`;
    case "locate_bottleneck":
      return `Aujourd’hui, sur "${theme}", quel point bloque le plus souvent l’avancement ?`;
    case "identify_dependency":
      return `Aujourd’hui, sur "${theme}", de qui ou de quoi dépendez-vous le plus pour avancer ?`;
    case "identify_missing_rule":
      return `Aujourd’hui, sur "${theme}", quelle règle ou quel cadre manque quand la situation se tend ?`;
    case "identify_missing_metric":
      return `Aujourd’hui, sur "${theme}", quel indicateur vous manque pour piloter ce point ?`;
    case "clarify_cause":
      return `Aujourd’hui, sur "${theme}", quelle cause explique principalement cette situation ?`;
    case "clarify_arbitration":
      return `Aujourd’hui, sur "${theme}", qui tranche quand il faut arbitrer ?`;
    case "test_formalization":
      return `Aujourd’hui, sur "${theme}", qu’est-ce qui n’est pas encore formalisé ?`;
    default:
      return `Pouvez-vous préciser ce point sur "${theme}" ?`;
  }
}

export function rewriteQuestion(
  input: QuestionRewriteInput
): string {
  const maxWords = input.maxWords ?? 22;
  let text = compact(input.rawQuestion);

  text = removeTrailingLists(text);
  text = removeWideAlternatives(text);

  if ((text.match(/\?/g) ?? []).length > 1) {
    text = `${text.split("?")[0].trim()} ?`;
  }

  if (countWords(text) > maxWords || /de bout en bout/i.test(text)) {
    text = simplifyByIntent(input.intent, input.theme);
  }

  return compact(text);
}