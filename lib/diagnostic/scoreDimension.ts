import { adminSupabase } from "@/lib/supabaseServer";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export type DimensionScore = {
  dimension: number;
  score: number;
  niveau: string;
  enjeux: string[];
  synthese: string;
};

export async function scoreDimension(
  sessionId: string,
  dimension: number
): Promise<DimensionScore> {

  const admin = adminSupabase();

  const { data: answers } = await admin
    .from("diagnostic_answers")
    .select("answer")
    .eq("session_id", sessionId)
    .eq("dimension", dimension);

  const texte = (answers ?? [])
    .map((a: any) => a.answer)
    .join("\n");

  const prompt = `
Tu es un expert en diagnostic stratégique PME.

Analyse les réponses suivantes et produis :

- score de maturité (1 à 5)
- niveau critique (fragile / intermédiaire / solide)
- 3 à 5 enjeux principaux
- synthèse dirigeant

Réponds uniquement en JSON :

{
 "score": number,
 "niveau": string,
 "enjeux": string[],
 "synthese": string
}

Réponses :

${texte}
`;

  const resp = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: "Analyse stratégique PME." },
      { role: "user", content: prompt }
    ]
  });

  const raw = resp.choices[0]?.message?.content ?? "{}";

  const json = JSON.parse(raw);

  return {
    dimension,
    score: json.score,
    niveau: json.niveau,
    enjeux: json.enjeux,
    synthese: json.synthese
  };
}