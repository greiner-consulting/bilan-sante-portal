// lib/diagnostic/chat.ts

import OpenAI from "openai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  throw new Error("Missing env var: OPENAI_API_KEY");
}

const client = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

export type ChatTurnInput = {
  extractedText: string;
  history: string[];
  userMessage: string;
  dimension: number;
  iteration: number;
};

export type AssistantJSON = {
  assistant_message: string;
  questions: string[];
  needs_validation: boolean;
};

const DIMENSIONS = [
  "Organisation & RH",
  "Commercial & Marchés",
  "Cycle de vente & Prix",
  "Exécution & Performance opérationnelle",
];

function buildPrompt(input: ChatTurnInput) {
  const dimensionName = DIMENSIONS[input.dimension - 1] ?? "Unknown";

  const systemPrompt = `
Tu es un consultant senior spécialisé dans le diagnostic stratégique de PME.

Tu conduis un diagnostic structuré en 4 dimensions :

1. Organisation & RH
2. Commercial & Marchés
3. Cycle de vente & Prix
4. Exécution & Performance opérationnelle

Dimension actuelle :
${dimensionName}

Itération actuelle :
${input.iteration}/3

Règles obligatoires :

Itération 1
- compréhension initiale
- poser EXACTEMENT 6 questions

Itération 2
- exploration causes et arbitrages
- poser EXACTEMENT 6 questions

Itération 3
- consolidation
- poser EXACTEMENT 5 questions
- proposer validation de la dimension

Contraintes :

- ne jamais inventer de chiffres
- questions qualitatives
- ton analytique et professionnel
- chaque question doit être claire et spécifique

Si itération 3 :

needs_validation = true
et proposer :
"Validez-vous cette dimension ? (oui/non)"

Réponds STRICTEMENT en JSON :

{
 "assistant_message": string,
 "questions": string[],
 "needs_validation": boolean
}
`;

  const userPrompt = `
CONTEXTE TRAME

${input.extractedText.slice(0, 12000)}

HISTORIQUE

${input.history.join("\n")}

MESSAGE UTILISATEUR

${input.userMessage}
`;

  return {
    system: systemPrompt.trim(),
    user: userPrompt.trim(),
  };
}

export async function runChatTurn(
  input: ChatTurnInput
): Promise<AssistantJSON> {
  const prompt = buildPrompt(input);

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";

  let parsed: any;

  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {
      assistant_message: raw,
      questions: [],
      needs_validation: false,
    };
  }

  return {
    assistant_message: String(parsed.assistant_message ?? ""),
    questions: Array.isArray(parsed.questions)
      ? parsed.questions.map(String)
      : [],
    needs_validation: Boolean(parsed.needs_validation),
  };
}