import type { InputIntent } from "@/lib/bilan-sante/session-model";

export interface InterpretedInput {
  intent: InputIntent;
  challengeReason?:
    | "too_broad"
    | "unclear"
    | "too_abstract"
    | "repeated"
    | "unknown_context"
    | "other";
}

function normalize(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

const YES_TOKENS = new Set(["oui", "ok", "validé", "valide", "yes"]);
const NO_TOKENS = new Set(["non", "no"]);

export function interpretUserInput(rawMessage: string): InterpretedInput {
  const message = normalize(rawMessage);

  if (!message) {
    return { intent: "off_topic_or_noise" };
  }

  if (YES_TOKENS.has(message)) {
    return { intent: "iteration_validation_yes" };
  }

  if (NO_TOKENS.has(message)) {
    return { intent: "iteration_validation_no" };
  }

  if (
    message.includes("incompréhensible") ||
    message.includes("incomprehensible") ||
    message.includes("je ne comprends pas") ||
    message.includes("pas clair") ||
    message.includes("flou")
  ) {
    return {
      intent: "question_challenge",
      challengeReason: "unclear",
    };
  }

  if (
    message.includes("trop large") ||
    message.includes("trop vaste") ||
    message.includes("trop global") ||
    message.includes("trop générique") ||
    message.includes("trop generale")
  ) {
    return {
      intent: "question_challenge",
      challengeReason: "too_broad",
    };
  }

  if (
    message.includes("abstrait") ||
    message.includes("trop abstrait") ||
    message.includes("théorique") ||
    message.includes("theorique")
  ) {
    return {
      intent: "question_challenge",
      challengeReason: "too_abstract",
    };
  }

  if (
    message.includes("déjà posée") ||
    message.includes("deja posee") ||
    message.includes("répétée") ||
    message.includes("repetee") ||
    message.includes("on l'a déjà vue") ||
    message.includes("on l a deja vue")
  ) {
    return {
      intent: "question_challenge",
      challengeReason: "repeated",
    };
  }

  if (
    message.includes("reformule") ||
    message.includes("peux-tu reformuler") ||
    message.includes("reformuler") ||
    message.includes("on parle de quoi")
  ) {
    return {
      intent: "clarification_request",
      challengeReason: "unknown_context",
    };
  }

  return {
    intent: "business_answer",
  };
}