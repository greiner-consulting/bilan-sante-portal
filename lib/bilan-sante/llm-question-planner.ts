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
  return text.replace(/\s*:\s*[^?]+\?$/, " ?");
}

function removeWideAlternatives(text: string): string {
  return text.replace(/\s+ou\s+[^?]+\?$/, " ?");
}

function simplifyByIntent(intent: QuestionIntent, theme: string): string {
  switch (intent) {
    case "open_core":
      return `Aujourd'hui, sur "${theme}", comment cela se passe-t-il concretement dans le fonctionnement reel ?`;
    case "clarify_mechanism":
      return `Aujourd'hui, sur "${theme}", par quel mecanisme la situation se produit-elle concretement ?`;
    case "identify_threshold":
      return `Aujourd'hui, sur "${theme}", a partir de quel seuil ou de quelle situation cela se tend-il reellement ?`;
    case "test_formalization":
      return `Aujourd'hui, sur "${theme}", qu'est-ce qui est reellement formalise et qu'est-ce qui ne l'est pas ?`;
    case "identify_dependency":
      return `Aujourd'hui, sur "${theme}", de qui ou de quoi dependez-vous le plus pour tenir ce point ?`;
    case "test_anticipation":
      return `Aujourd'hui, sur "${theme}", comment ce point est-il anticipe en amont ?`;
    case "confirm_strength":
      return `Aujourd'hui, sur "${theme}", qu'est-ce qui fonctionne de maniere vraiment solide ?`;
    case "validate_priority":
      return `Aujourd'hui, sur "${theme}", pourquoi ce point doit-il etre traite en priorite ?`;
    default:
      return `Pouvez-vous preciser ce point sur "${theme}" ?`;
  }
}

export function rewriteQuestion(input: QuestionRewriteInput): string {
  const maxWords = input.maxWords ?? 24;
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
