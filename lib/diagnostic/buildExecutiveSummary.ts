import { adminSupabase } from "@/lib/supabaseServer";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export type ExecutiveSummary = {
  score_global: number;
  niveau_global: string;
  forces: string[];
  faiblesses: string[];
  priorites: string[];
  synthese: string;
};

export async function buildExecutiveSummary(sessionId: string): Promise<ExecutiveSummary> {

  const admin = adminSupabase();

  const { data: scores } = await admin
    .from("diagnostic_scores")
    .select("*")
    .eq("session_id", sessionId)
    .order("dimension");

  const texte = (scores ?? [])
    .map((s: any) => `
Dimension ${s.dimension}
Score : ${s.score}
Niveau : ${s.niveau}

Enjeux :
${(s.enjeux ?? []).join(", ")}

Synthese :
${s.synthese}
`)
    .join("\n");

  const prompt = `
Tu es un expert en diagnostic stratégique PME.

Analyse les résultats suivants et produis une synthèse dirigeant.

Objectif :
- identifier forces majeures
- identifier faiblesses critiques
- proposer 3 priorités stratégiques

Réponds uniquement en JSON :

{
 "score_global": number,
 "niveau_global": string,
 "forces": string[],
 "faiblesses": string[],
 "priorites": string[],
 "synthese": string
}

Résultats :

${texte}
`;

  const resp = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: "Expert en diagnostic stratégique PME."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  });

  const raw = resp.choices[0]?.message?.content ?? "{}";

  const json = JSON.parse(raw);

  return {
    score_global: json.score_global,
    niveau_global: json.niveau_global,
    forces: json.forces,
    faiblesses: json.faiblesses,
    priorites: json.priorites,
    synthese: json.synthese
  };
}