import OpenAI from "openai";

/*
 * questionGeneratorLLM.ts
 *
 * This module provides an interface to generate interview questions using a
 * large language model.  Given a list of facts extracted from a diagnostic
 * document, a target dimension and iteration number, it prompts the LLM to
 * produce concise, specific and actionable questions tailored to each fact.
 * The structure of the prompt encourages the model to use a direct and
 * benevolent tone while varying the angles of exploration (example,
 * magnitude, mechanism, causality, dependency, arbitration, formalization,
 * transition, economics, frequency, feedback).  The output is parsed back
 * into a list of question objects associated with their originating fact.
 */

/**
 * A summary of a diagnostic fact used to guide question generation.  In addition
 * to the core fields describing the theme, raw signal and managerial risk, the
 * structure may carry the current progress of the fact (identified, questioned,
 * illustrated, etc.) and the list of remaining angles to explore.  Providing
 * these hints helps the language model propose questions that target the
 * unexplored angles instead of repeating what has already been asked.
 */
export interface FactSummary {
  id: string;
  theme: string;
  raw_signal: string;
  managerial_risk: string;
  recommended_entry_angle: string;
  /**
   * Current progress of this fact in the diagnostic process.  Typical values
   * include: identified, questioned, illustrated, quantified, causalized,
   * arbitrated, stabilised, consolidated.  When undefined, the progress is
   * unknown.
   */
  progress?: string;
  /**
   * Remaining angles that still need to be explored for this fact.  Each
   * element should be one of the allowed angles (example, magnitude, mechanism,
   * causality, dependency, arbitration, formalization, transition, economics,
   * frequency, feedback).  If undefined, the model will select angles
   * autonomously.
   */
  missing_angles?: string[];
}

export interface GeneratedQuestion {
  fact_id: string;
  theme: string;
  question: string;
  intended_angle: string;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/**
 * Generate a batch of questions for a given dimension and iteration using a
 * large language model.  The function collates facts into a summary list and
 * instructs the model to propose one or two questions per fact, focusing on
 * the recommended entry angle and exploring other angles if beneficial.
 */
export async function generateQuestionBatch(params: {
  facts: FactSummary[];
  dimension: number;
  iteration: number;
}): Promise<GeneratedQuestion[]> {
  const { facts, dimension, iteration } = params;
  if (facts.length === 0) return [];
  // Construct a JSON summary of the facts for the prompt.  Only include
  // fields that are essential for the model to craft relevant questions.
  // Assemble a list of fact summaries for the prompt.  In addition to the
  // minimal fields (id, theme, raw_signal, managerial_risk and
  // recommended_entry_angle), we include optional progress and missing_angles
  // hints when available.  These hints will help the model tailor the angle
  // selection to the remaining gaps in the coverage.
  const factSummaries = facts.map((f) => {
    const summary: any = {
      fact_id: f.id,
      theme: f.theme,
      raw_signal: f.raw_signal,
      managerial_risk: f.managerial_risk,
      recommended_entry_angle: f.recommended_entry_angle,
    };
    if (f.progress) summary.progress = f.progress;
    if (Array.isArray(f.missing_angles) && f.missing_angles.length > 0) {
      summary.missing_angles = f.missing_angles;
    }
    return summary;
  });
  const prompt = `
Tu es un consultant senior en diagnostic des PME et tu prépares une série de questions pour un entretien avec le dirigeant.

On te fournit une liste de signaux (constats) extraits d'une trame initiale.  Pour chaque signal, propose au maximum deux questions
qui permettent de creuser le point de manière concrète et bienveillante.  Chaque question doit être concise (une seule phrase)
et se concentrer sur un angle précis (exemple, ordre de grandeur, fonctionnement concret, cause principale, dépendance,
arbitrage, formalisation, transition, impact économique, fréquence, retour d'expérience).

Les résumés des signaux peuvent inclure :
- le niveau d'avancement actuel (progress) si le signal a déjà été partiellement exploré,
- la liste des angles restants (missing_angles) lorsqu'ils sont connus.  Dans ce cas, privilégie l'exploration de ces angles
  plutôt que de répéter un angle déjà couvert.

Règles impératives :
• Utilise un ton direct mais toujours bienveillant.
• Évite les formulations vagues ou génériques.
• Ne répète pas le texte du signal mot à mot, reformule pour guider le dirigeant.
• Si des angles restants sont indiqués, choisis l'un d'entre eux en priorité ; sinon sélectionne l'angle que tu juges le plus pertinent.
• Retourne STRICTEMENT un objet JSON de la forme : { "questions": [ { "fact_id": "string", "question": "string", "intended_angle": "string" } ] }.
• Ne produis aucun autre texte ni commentaire hors de cet objet JSON.

FACTS:
${JSON.stringify(factSummaries, null, 2)}

Dimension: ${dimension}, Iteration: ${iteration}
`.trim();
  try {
    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL_CHAT || "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Consultant senior en retournement de PME. Génération de questions structurées uniquement en JSON.",
        },
        { role: "user", content: prompt },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    // Validate and normalise the returned questions.  We only keep non-empty
    // questions and angles.
    return questions
      .map((q: any) => {
        return {
          fact_id: String(q?.fact_id ?? "").trim(),
          theme: facts.find((f) => f.id === q?.fact_id)?.theme ?? "",
          question: String(q?.question ?? "").trim(),
          intended_angle: String(q?.intended_angle ?? "").trim(),
        } as GeneratedQuestion;
      })
      .filter((q) => q.fact_id && q.question);
  } catch {
    return [];
  }
}