import OpenAI from "openai";

/*
 * factExtractorLLM.ts
 *
 * This module exposes an interface for extracting structured facts from an arbitrary
 * textual document using a large language model.  It is meant to replace the
 * heuristic‑based extraction currently implemented in legacyDiagnosticIngestion.ts.
 * The function defined herein accepts a document, a dimension identifier and a
 * description of the dimension (investigation goals, allowed themes, forbidden
 * themes and confusion risks) and returns an array of fact objects.  Each fact
 * contains a theme, raw signal, managerial risk, recommended entry angle and
 * other metadata.  The extraction uses a strict JSON schema to ensure
 * predictable parsing.  See README_modifications.md for integration details.
 */

export interface DimensionSpec {
  id: number;
  name: string;
  investigationGoals: string[];
  allowedThemes: string[];
  forbiddenThemes: string[];
  confusionRisks: string[];
}

export interface ExtractedFact {
  theme: string;
  raw_signal: string;
  managerial_risk: string;
  recommended_entry_angle: string;
  signal_kind: string;
  instruction_goal: string;
  proof_level: number;
  confidence_score: number;
  criticality_score: number;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/**
 * Extracts structured facts from a document for a specific diagnostic dimension.  The
 * large language model is prompted with the document and instructions describing
 * the dimension and expected JSON schema.  Returns an array of facts if the
 * extraction succeeds or an empty array otherwise.
 */
export async function extractFactsFromText(params: {
  document: string;
  dimension: DimensionSpec;
}): Promise<ExtractedFact[]> {
  const { document, dimension } = params;
  // Build a prompt similar to the one used in diagnosticQuestionPlanner.ts but
  // parameterised by the passed dimension specification.
  const prompt = `
Tu es un consultant senior en diagnostic stratégique de PME.

Tu lis une trame initiale et tu dois extraire des signaux réellement exploitables
pour ouvrir la dimension ${dimension.id} — ${dimension.name}.

Tu ne dois PAS produire de reformulation d'entretien.  Tu dois produire des
signaux bruts, concrets, questionnables.

Réponds STRICTEMENT en JSON :

{
  "facts": [
    {
      "theme": "string",
      "raw_signal": "string",
      "managerial_risk": "string",
      "recommended_entry_angle": "example|magnitude|mechanism|causality|dependency|arbitration|formalization|transition|economics|frequency|feedback",
      "signal_kind": "string",
      "instruction_goal": "verify|quantify|explain_cause|test_arbitration|measure_impact",
      "proof_level": 1,
      "confidence_score": 0,
      "criticality_score": 0
    }
  ]
}

Règles impératives :
- uniquement des signaux reliés à la dimension demandée
- theme doit rester dans les thèmes autorisés
- raw_signal = formulation la plus proche possible de ce qui est présent dans la trame
- raw_signal doit être concret, pas un thème abstrait
- raw_signal ne doit pas être une consigne d'analyste
- managerial_risk doit être concret et spécifique
- recommended_entry_angle doit être pertinent pour une première exploration
- signal_kind doit être un label métier court
- confidence_score et criticality_score entre 0 et 100
- proof_level entre 1 et 4
- 0 texte hors JSON

OBJECTIFS D'ENQUÊTE
${dimension.investigationGoals.map((x) => `- ${x}`).join('\n')}

THEMES AUTORISÉS
${dimension.allowedThemes.map((x) => `- ${x}`).join('\n')}

THEMES INTERDITS
${dimension.forbiddenThemes.map((x) => `- ${x}`).join('\n')}

RISQUES DE CONFUSION À ÉVITER
${dimension.confusionRisks.map((x) => `- ${x}`).join('\n')}

TRAME :
${document.slice(0, 15000)}
`.trim();
  try {
    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
      temperature: 0.05,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Consultant senior en retournement de PME. Tu extrais des signaux concrets et questionnables, strictement dans la dimension demandée. JSON uniquement.",
        },
        { role: "user", content: prompt },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const facts = Array.isArray(parsed?.facts) ? parsed.facts : [];
    // Validate and normalise numeric fields to safe ranges.
    return facts.map((f: any) => {
      const proof = Math.min(4, Math.max(1, Number(f?.proof_level ?? 2)));
      const confidence = Math.max(0, Math.min(100, Number(f?.confidence_score ?? 40)));
      const critical = Math.max(0, Math.min(100, Number(f?.criticality_score ?? 60)));
      return {
        theme: String(f?.theme ?? "").trim(),
        raw_signal: String(f?.raw_signal ?? "").trim(),
        managerial_risk: String(f?.managerial_risk ?? "").trim(),
        recommended_entry_angle: String(f?.recommended_entry_angle ?? "mechanism").trim(),
        signal_kind: String(f?.signal_kind ?? "").trim(),
        instruction_goal: String(f?.instruction_goal ?? "verify").trim(),
        proof_level: proof,
        confidence_score: confidence,
        criticality_score: critical,
      } as ExtractedFact;
    });
  } catch {
    return [];
  }
}